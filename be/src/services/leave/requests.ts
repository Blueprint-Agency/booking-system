import { and, asc, desc, eq, gte, inArray, lte, ne, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../../db'
import { leavePools, leaveRequests } from '../../db/schema/leave'
import { instructors } from '../../db/schema/catalog'
import { globalPolicy } from '../../db/schema/policy'
import { staffUsers } from '../../db/schema/identity'
import { conflictMessage, findOccupancyConflicts, leaveDaysPhrase } from '../schedule/occupancy'
import type { Tx } from '../schedule/roster'
import { emailEveryAdmin, sendTemplatedEmail } from '../notifications/send'
import { reportError } from '../../shared/logger'
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../shared/errors'
import { R2_BUCKET, putObject, signedObjectUrl } from '../../lib/r2'
import { sgFormat } from '../../lib/time'
import * as rules from './rules'

/**
 * Leave requests an instructor files for themselves.
 *
 * Every rule lives in `./rules.ts`; this module only fetches what those rules
 * need and writes the row. The one rule it can't ask a pure function for is the
 * clash, and even that reuses machinery: `findOccupancyConflicts` is the same
 * lookup that stops an instructor being double-booked, asked in reverse. It
 * already excludes cancelled and non-active events, so a cancelled class
 * correctly does not block leave.
 *
 * Approve / reject / revoke live here too (`decideLeaveRequest`), but are only
 * ever reachable through the admin route subtree — see routes/portal/admin/leave.ts.
 */

export type LeaveRequestRow = typeof leaveRequests.$inferSelect

/** One Leave Type's year as the instructor's own page reads it. The three grant
 *  figures are shown apart so a one-off surplus is distinguishable from the
 *  yearly figure: Assigned is what the profile says, Carried is what survived
 *  last year, and Pool is what leave is actually drawn from — after an admin's
 *  adjustment the Pool need not equal the other two summed. */
export interface LeaveBalance {
  type: rules.LeaveType
  /** The yearly figure on the instructor's profile. */
  assigned_days: number
  /** Of the Pool, how much came from last year. Only annual ever carries. */
  carried_days: number
  /** This Leave Year's Pool for this type — what Remaining counts down from. */
  pool_days: number
  /** Taken — approved days only, what has actually been used. */
  taken_days: number
  /** Awaiting a decision. Part of Committed, not part of Taken. */
  pending_days: number
  /** Pool − Committed: what can still be applied for, pending included. May be
   *  negative if the figure was lowered below what is already Committed. */
  remaining_days: number
}

/** numeric(4,1) comes back as a string. */
const toDaysRow = (r: LeaveRequestRow): rules.LeaveDaysRow => ({
  type: r.type,
  leaveYear: r.leaveYear,
  status: r.status,
  days: Number(r.days),
})

const LEAVE_TYPES = ['annual', 'medical', 'study'] as const

/** One Leave Type's grant for a year: the Pool, how much of it was carried, and
 *  the Assigned Days it was composed from. Assigned is read live from the
 *  profile rather than stored on the row — with Carried it is what the year was
 *  worth untouched, which is the ceiling an admin's adjustment is bounded by. */
interface LeavePool {
  assigned: number
  pool: number
  carried: number
}

/**
 * This instructor's Pool for `leaveYear`, every Leave Type — materialised on
 * this read if the year has never been read before. There is no 1 January job;
 * this IS the job, and it runs when someone first asks, which is also why a new
 * Leave Type needs no backfill: the missing row is written the first time
 * anyone reads the year, carrying the same 0 a backfill would have written.
 *
 * Every caller that needs a Pool comes through here, and it reads, calls and
 * writes — **no arithmetic**. Last year's Remaining is `rules.leavePoolFigures`,
 * what survives the year boundary is `rules.carriedDays` (which is where medical
 * is refused a carry, and where a negative Remaining is clamped), and composing
 * the two is `rules.poolDays`.
 *
 * Carried comes from the previous year's **stored** Pool minus its Committed
 * days. No stored Pool for that year — a new instructor, or a year nobody ever
 * opened — carries 0 and looks no further back, which is what makes the chain
 * finite rather than recursive to the beginning of time.
 *
 * A **future** Leave Year is computed and NOT written. Annual leave must start
 * after today, so an instructor filing next January's leave in August would
 * otherwise freeze next year's Pool at Carried = 0 and the real rollover could
 * never apply their carry. The figure is honest to submit against; it becomes a
 * row when the year arrives.
 *
 * Three things about the transaction:
 *
 *  - The locked select of the instructor row is the FIRST statement, and it is
 *    the same lock the submission path already takes — not a second one. It is
 *    one row per instructor, so two instructors never wait on each other.
 *  - It doubles as the permission check: admins and superadmins have no
 *    `instructors` row and no leave concept at all.
 *  - Insert-ignoring-conflicts and re-reading (rather than trusting the insert)
 *    means a concurrent first read cannot produce a second Pool or a failure —
 *    whichever writer won, this returns the Pool that is actually stored.
 */
async function leavePoolsFor(
  tx: Tx,
  instructorId: string,
  leaveYear: number,
): Promise<Record<rules.LeaveType, LeavePool>> {
  const [instructor] = await tx
    .select({
      annual: instructors.annualLeaveDays,
      medical: instructors.medicalLeaveDays,
      study: instructors.studyLeaveDays,
    })
    .from(instructors)
    .where(eq(instructors.staffUserId, instructorId))
    .for('update')
    .limit(1)
  if (!instructor) throw new ForbiddenError('not_an_instructor')

  const [policy] = await tx
    .select({ carryOverCapDays: globalPolicy.leaveCarryOverCapDays })
    .from(globalPolicy)
    .limit(1)
  if (!policy) throw new NotFoundError('policy_not_seeded')

  // The year immediately before this one, and nothing before that.
  const previousYear = leaveYear - 1
  const previousPools = new Map(
    (
      await tx
        .select({ type: leavePools.type, days: leavePools.days })
        .from(leavePools)
        .where(
          and(eq(leavePools.instructorId, instructorId), eq(leavePools.leaveYear, previousYear)),
        )
    ).map(r => [r.type, Number(r.days)]),
  )
  // No Pool last year means nothing can carry, so the rows are not worth asking for.
  const previousRows =
    previousPools.size === 0
      ? []
      : (
          await tx
            .select()
            .from(leaveRequests)
            .where(
              and(
                eq(leaveRequests.instructorId, instructorId),
                eq(leaveRequests.leaveYear, previousYear),
              ),
            )
        ).map(toDaysRow)

  const carriedInto = (type: rules.LeaveType): number => {
    const previousPool = previousPools.get(type)
    if (previousPool === undefined) return 0
    return rules.carriedDays(
      type,
      rules.leavePoolFigures(type, previousPool, previousRows, previousYear).remaining,
      policy.carryOverCapDays,
    )
  }
  // One shape per type, off the instructor row — the Assigned figure for every
  // type is a column on that row, which is what keeps this uniform.
  const freshFor = (type: rules.LeaveType): LeavePool => {
    const carried = carriedInto(type)
    const assigned = instructor[type]
    return { assigned, pool: rules.poolDays(assigned, carried), carried }
  }
  const fresh: Record<rules.LeaveType, LeavePool> = {
    annual: freshFor('annual'),
    medical: freshFor('medical'),
    study: freshFor('study'),
  }

  // A Leave Year that has not arrived is computed, never frozen. See above.
  if (leaveYear > rules.leaveYearOf(rules.sgToday(new Date()))) return fresh

  await tx
    .insert(leavePools)
    .values(
      LEAVE_TYPES.map(type => ({
        instructorId,
        type,
        leaveYear,
        days: fresh[type].pool.toFixed(1),
        carriedDays: fresh[type].carried.toFixed(1),
      })),
    )
    .onConflictDoNothing()

  // Pool and Carried both come back from the row, never recomputed. An admin's
  // adjustment back-solves the Pool from a Remaining, so a stored Pool is
  // deliberately NOT Assigned + Carried any more; recomputing Carried alongside
  // it would report a number that contradicts the Pool it is meant to explain.
  // Assigned is the profile's live figure either way — it is not part of the
  // freeze, and it is what the adjustment ceiling is measured from.
  const stored = new Map(
    (
      await tx
        .select({
          type: leavePools.type,
          days: leavePools.days,
          carriedDays: leavePools.carriedDays,
        })
        .from(leavePools)
        .where(and(eq(leavePools.instructorId, instructorId), eq(leavePools.leaveYear, leaveYear)))
    ).map(r => [
      r.type,
      { assigned: instructor[r.type], pool: Number(r.days), carried: Number(r.carriedDays) },
    ]),
  )
  return {
    annual: stored.get('annual') ?? fresh.annual,
    medical: stored.get('medical') ?? fresh.medical,
    study: stored.get('study') ?? fresh.study,
  }
}

// ── The admin's view of one instructor's year ──────────────────────────────

/** One Leave Type's year as the admin staff profile RESPONSE carries it —
 *  snake_case, a subset, and an API contract. `rules.LeavePoolFigures` is the
 *  camelCase computation it is shaped from; this is not that type renamed, and
 *  the two are free to diverge. Assigned Days are on the profile itself; these
 *  three are the year in flight, and after an adjustment `pool_days` may exceed
 *  Assigned + Carried — that is the adjustment, honestly reported, not a drift. */
export interface LeaveFiguresResponse {
  carried_days: number
  pool_days: number
  remaining_days: number
}
export type InstructorLeaveFigures = Record<rules.LeaveType, LeaveFiguresResponse>

/** Which Leave Year "now" is. The only one an admin may adjust: a future year
 *  has no stored Pool and a past one is frozen history. */
const currentLeaveYear = () => rules.leaveYearOf(rules.sgToday(new Date()))

async function yearRows(tx: Tx, instructorId: string, leaveYear: number) {
  return (
    await tx
      .select()
      .from(leaveRequests)
      .where(
        and(eq(leaveRequests.instructorId, instructorId), eq(leaveRequests.leaveYear, leaveYear)),
      )
  ).map(toDaysRow)
}

async function figuresFor(
  tx: Tx,
  instructorId: string,
  leaveYear: number,
): Promise<InstructorLeaveFigures> {
  const pools = await leavePoolsFor(tx, instructorId, leaveYear)
  const rows = await yearRows(tx, instructorId, leaveYear)
  const of = (type: rules.LeaveType): LeaveFiguresResponse => {
    const f = rules.leavePoolFigures(type, pools[type].pool, rows, leaveYear)
    return { carried_days: pools[type].carried, pool_days: f.pool, remaining_days: f.remaining }
  }
  return { annual: of('annual'), medical: of('medical'), study: of('study') }
}

/**
 * This Leave Year's figures for each of these instructors — what the admin staff
 * list shows so the edit form prefills without a second call.
 *
 * A read that writes, like every Pool read: it goes through `leavePoolsFor`,
 * so the year is materialised under the usual per-instructor lock rather than
 * being guessed at.
 */
async function currentLeaveFigures(
  instructorIds: readonly string[],
): Promise<Map<string, InstructorLeaveFigures>> {
  if (instructorIds.length === 0) return new Map()
  const leaveYear = currentLeaveYear()
  return db.transaction(async tx => {
    const out = new Map<string, InstructorLeaveFigures>()
    // ponytail: one round trip per instructor. Batch the pool/request reads if
    // the staff list ever gets long enough to notice.
    for (const id of instructorIds) out.set(id, await figuresFor(tx, id, leaveYear))
    return out
  })
}

/**
 * Attach this Leave Year's Carried / Pool / Remaining to every instructor in a
 * list of staff rows, so the admin edit form prefills without a second call.
 * A row with no Assigned Days is not an instructor and is passed through
 * untouched — an admin has no leave concept to have figures for.
 *
 * Generic over the row rather than importing the staff profile type: leave knows
 * what leave figures are, and nothing here needs to know what else a staff row
 * carries.
 */
export async function withLeaveFigures<T extends { id: string; annualLeaveDays?: number }>(
  rows: T[],
): Promise<(T & { leave?: InstructorLeaveFigures })[]> {
  const figures = await currentLeaveFigures(
    rows.filter(r => r.annualLeaveDays !== undefined).map(r => r.id),
  )
  return rows.map(r => {
    const leave = figures.get(r.id)
    return leave ? { ...r, leave } : r
  })
}

/** One instructor's **Assigned Days**, or nothing at all if this staff user is
 *  not an instructor — the caller spreads it onto a staff row, so absent beats
 *  null. */
export async function assignedLeaveDays(
  staffUserId: string,
): Promise<{ annualLeaveDays?: number; medicalLeaveDays?: number; studyLeaveDays?: number }> {
  const [row] = await db
    .select({
      annualLeaveDays: instructors.annualLeaveDays,
      medicalLeaveDays: instructors.medicalLeaveDays,
      studyLeaveDays: instructors.studyLeaveDays,
    })
    .from(instructors)
    .where(eq(instructors.staffUserId, staffUserId))
    .limit(1)
  return row ?? {}
}

export interface AdjustRemainingInput {
  instructorId: string
  /** The Remaining the instructor should have. Omitted types are left alone. */
  annual?: number
  medical?: number
  study?: number
}

/**
 * An admin correcting a live Leave Year: they type the Remaining, and the Pool
 * is back-solved from it (`rules.poolForRemaining`) so that the number they typed
 * is the number the instructor then sees.
 *
 * Carried is left exactly as stored. Assigned, Carried and the new Pool are then
 * three honest numbers whose sum no longer has to agree — which is the point of
 * an adjustment, and why Carried is stored rather than recomputed.
 *
 * The ceiling is Assigned + Carried, NOT the stored Pool: a previous adjustment
 * may have moved the Pool, and bounding against a number this same operation
 * writes would make it a one-way ratchet — a figure typed too low could never be
 * put back until January. See `rules.checkRemainingAdjustment`.
 *
 * Runs under the SAME per-instructor lock the submission path takes, taken by
 * `leavePoolsFor` as the transaction's first statement: an adjustment and a
 * submission cannot both read the same "before".
 */
export async function adjustRemainingDays(
  input: AdjustRemainingInput,
): Promise<InstructorLeaveFigures> {
  const leaveYear = currentLeaveYear()
  return db.transaction(async tx => {
    const pools = await leavePoolsFor(tx, input.instructorId, leaveYear)
    const rows = await yearRows(tx, input.instructorId, leaveYear)

    for (const type of LEAVE_TYPES) {
      const desired = input[type]
      if (desired === undefined) continue
      const check = rules.checkRemainingAdjustment(
        type,
        desired,
        rules.poolDays(pools[type].assigned, pools[type].carried),
      )
      if (!check.ok) throw new BadRequestError(check.code, { message: check.message })
      const committed = rules.sumLeaveDays(rows, {
        type,
        leaveYear,
        statuses: rules.COMMITTED_STATUSES,
      })
      await tx
        .update(leavePools)
        .set({ days: rules.poolForRemaining(desired, committed).toFixed(1), updatedAt: new Date() })
        .where(
          and(
            eq(leavePools.instructorId, input.instructorId),
            eq(leavePools.type, type),
            eq(leavePools.leaveYear, leaveYear),
          ),
        )
    }
    return figuresFor(tx, input.instructorId, leaveYear)
  })
}

/** Nothing but naming: `rules.leavePoolFigures` does the counting, this maps its
 *  figures onto the response fields. No arithmetic belongs in here. */
function balances(
  pool: Record<rules.LeaveType, LeavePool>,
  rows: rules.LeaveDaysRow[],
  leaveYear: number,
): LeaveBalance[] {
  return LEAVE_TYPES.map(type => {
    const f = rules.leavePoolFigures(type, pool[type].pool, rows, leaveYear)
    return {
      type: f.type,
      assigned_days: pool[type].assigned,
      carried_days: pool[type].carried,
      pool_days: f.pool,
      taken_days: f.taken,
      pending_days: f.pending,
      remaining_days: f.remaining,
    }
  })
}

/** The instructor's own page: every type's balance for `leaveYear`, plus their whole
 *  history (all years — the balances are the year-scoped part).
 *
 *  Which year "no year" means is a domain question, so it is answered here and
 *  not in the route: the leave year the Singapore-local today falls in.
 *
 *  A read that writes: this is where a Leave Year's Pool is first materialised,
 *  so it runs in a transaction under the instructor's lock. */
export async function getOwnLeave(
  instructorId: string,
  leaveYear = rules.leaveYearOf(rules.sgToday(new Date())),
): Promise<{ leave_year: number; balances: LeaveBalance[]; requests: LeaveRequestRow[] }> {
  return db.transaction(async tx => {
    const pool = await leavePoolsFor(tx, instructorId, leaveYear)
    const rows = await tx
      .select()
      .from(leaveRequests)
      .where(eq(leaveRequests.instructorId, instructorId))
      .orderBy(desc(leaveRequests.startDate), desc(leaveRequests.createdAt))
    return {
      leave_year: leaveYear,
      balances: balances(pool, rows.map(toDaysRow), leaveYear),
      requests: rows,
    }
  })
}

export interface SubmitLeaveInput {
  instructorId: string
  type: rules.LeaveType
  startDate: rules.PlainDate
  endDate: rules.PlainDate
  /** `morning` / `afternoon` on a single date; a range must be full days. */
  halfDay?: rules.LeaveHalfDay
  reason: string
}

/**
 * The Pool read, the clash check and the insert are one transaction,
 * serialised per instructor by locking that instructor's OWN row as the first
 * statement in it. Without that, two requests that each fit the remaining
 * Remaining can both read the same "before" and both be accepted — the very
 * over-commitment "pending counts against your Pool" exists to stop.
 *
 * The lock is on `instructors`, not on the leave rows: what has to be kept out
 * is a row that does not exist yet, and an absent row cannot be locked. It is
 * one row per instructor, so two instructors never wait on each other.
 */
export async function submitLeaveRequest(input: SubmitLeaveInput): Promise<LeaveRequestRow> {
  const now = new Date()
  const leaveYear = rules.leaveYearOf(input.startDate)
  const halfDay = input.halfDay ?? 'none'

  const row = await db.transaction(async tx => {
    // THE FIRST statement: the **Leave Cap** lock. Locking only the applicant's
    // own instructor row is not enough — two Cover Group members submitting the
    // same dates take two different locks, both read a clear calendar and both
    // pass. So every row of the counted set is locked, in staff-user-id order so
    // two transactions cannot deadlock. A study request serialises study
    // submissions studio-wide, which at this scale is cheaper than any correct
    // alternative. The applicant's own row is always inside the set, so the
    // narrower lock `leavePoolsFor` takes next is already held.
    // ponytail: an annual request from a NON-member locks the group's rows for
    // nothing — deciding otherwise needs the applicant's membership before the
    // lock. Fold it into the where clause as an EXISTS if submissions ever
    // contend.
    const locked = await tx
      .select({ id: instructors.staffUserId, inCoverGroup: instructors.inCoverGroup })
      .from(instructors)
      .where(
        input.type === 'study'
          ? undefined
          : or(eq(instructors.inCoverGroup, true), eq(instructors.staffUserId, input.instructorId)),
      )
      .orderBy(asc(instructors.staffUserId))
      .for('update')

    // FIRST statement, and the reason there is a transaction at all: its first
    // statement takes this instructor's row lock, and it is also the permission
    // check — admins and superadmins have no `instructors` row. It returns the
    // Pool this submission is measured against, materialising it if this is the
    // first anyone has touched `leaveYear`, all under that one lock.
    const pool = await leavePoolsFor(tx, input.instructorId, leaveYear)

    // The query narrows to this instructor and leave year; which statuses and
    // which type count is the pure rule's business.
    const existing = await tx
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.instructorId, input.instructorId), eq(leaveRequests.leaveYear, leaveYear)))

    const check = rules.checkLeaveSubmission({
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      halfDay,
      today: rules.sgToday(now),
      pool: pool[input.type].pool,
      committedDays: rules.sumLeaveDays(existing.map(toDaysRow), {
        type: input.type,
        leaveYear,
        statuses: rules.COMMITTED_STATUSES,
      }),
    })
    if (!check.ok) throw new BadRequestError(check.code, { message: check.message })

    // The **Leave Caps**. The queries narrow — this instructor's Cover Group
    // membership, the two caps, and every OTHER instructor's occupying leave
    // overlapping the requested dates — and `rules.checkLeaveCaps` decides which
    // of those rows each cap counts, and whether the peak clears it.
    const [caps] = await tx
      .select({
        coverGroup: globalPolicy.coverGroupLeaveCap,
        study: globalPolicy.studyLeaveCap,
      })
      .from(globalPolicy)
      .limit(1)
    if (!caps) throw new NotFoundError('policy_not_seeded')
    const peers = (
      await tx
        .select({
          name: staffUsers.name,
          type: leaveRequests.type,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          halfDay: leaveRequests.halfDay,
          inCoverGroup: instructors.inCoverGroup,
        })
        .from(leaveRequests)
        .innerJoin(staffUsers, eq(staffUsers.id, leaveRequests.instructorId))
        .innerJoin(instructors, eq(instructors.staffUserId, leaveRequests.instructorId))
        .where(
          and(
            ne(leaveRequests.instructorId, input.instructorId),
            // Pending counts, exactly as it does for the Pool: the first to
            // submit holds the day. A rejection frees it at that moment.
            inArray(leaveRequests.status, [...rules.OCCUPYING_STATUSES]),
            lte(leaveRequests.startDate, input.endDate),
            gte(leaveRequests.endDate, input.startDate),
          ),
        )
    ).map(p => ({
      instructorName: p.name,
      type: p.type,
      inCoverGroup: p.inCoverGroup,
      ...rules.leaveWindow(p.startDate, p.endDate, p.halfDay),
    }))
    const capped = rules.checkLeaveCaps({
      type: input.type,
      // The applicant's row is always inside the locked set, so their Cover
      // Group membership is already read — no second query for it.
      inCoverGroup: locked.find(r => r.id === input.instructorId)?.inCoverGroup ?? false,
      window: rules.leaveWindow(input.startDate, input.endDate, halfDay),
      peers,
      coverGroupCap: caps.coverGroup,
      studyCap: caps.study,
    })
    if (!capped.ok) throw new ConflictError(capped.code, { message: capped.message })

    // The clash rule, in reverse: ask occupancy what this instructor is already on
    // across the requested days (only the requested HALF, if it is a half day),
    // and keep only what has yet to finish.
    // Runs on THIS transaction's connection, not the pool. A transaction that
    // awaits a second connection deadlocks the pool once enough of them are in
    // flight at once, and a wedged pool takes down every route, not just leave.
    const conflicts = rules.futureConflicts(
      await findOccupancyConflicts(
        { kind: 'instructor', id: input.instructorId },
        rules.leaveWindow(input.startDate, input.endDate, halfDay),
        undefined,
        tx,
      ),
      now,
    )
    if (conflicts.length > 0) {
      // Leave occupies an instructor, so their OWN pending/approved leave comes back
      // here too. That is not a booking to cancel, so it gets its own sentence —
      // and a real event, being the actionable one, wins when both turn up.
      const events = conflicts.filter(c => c.kind !== 'leave')
      const first = conflicts[0]!
      throw new ConflictError('leave_clash', {
        message:
          events.length > 0
            ? `${conflictMessage('Your schedule', events)} Cancel it before requesting leave.`
            : `You already have leave ${leaveDaysPhrase(first)}. Withdraw or cancel that ` +
              `request before filing another over the same dates.`,
        conflicts,
      })
    }

    const [inserted] = await tx
      .insert(leaveRequests)
      .values({
        instructorId: input.instructorId,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        halfDay,
        days: check.days.toFixed(1),
        leaveYear: check.leaveYear,
        reason: input.reason,
      })
      .returning()
    if (!inserted) throw new BadRequestError('leave_request_not_created')
    return inserted
  })

  // Outside the transaction on purpose: the lock is released before anything
  // touches SMTP.
  await emailAdminsOfSubmission(row)
  return row
}

/** Withdraw a pending request, or cancel an approved one that hasn't started.
 *  Both give the days back with no arithmetic: Committed is a sum over rows. */
export async function transitionOwnLeaveRequest(
  action: 'withdraw' | 'cancel',
  instructorId: string,
  id: string,
): Promise<LeaveRequestRow> {
  const [row] = await db
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.id, id), eq(leaveRequests.instructorId, instructorId)))
    .limit(1)
  if (!row) throw new NotFoundError('leave_request_not_found')

  const check = rules.checkOwnLeaveTransition(action, row, rules.sgToday(new Date()))
  if (!check.ok) throw new ConflictError(check.code, { message: check.message })

  const [updated] = await db
    .update(leaveRequests)
    .set({ status: check.status, updatedAt: new Date() })
    .where(eq(leaveRequests.id, id))
    .returning()
  if (!updated) throw new NotFoundError('leave_request_not_found')
  return updated
}

// ── The Supporting Document ────────────────────────────────────────────────

/** How long a signed link lives. Long enough to open, short enough that a copied
 *  URL in a chat window is worthless by the time anyone tries it. */
export const SUPPORTING_DOCUMENT_URL_TTL_SECONDS = 300

/** The bucket is optional in env (see lib/r2.ts), so both paths say so
 *  plainly rather than failing as an unexplained 500. */
function requireBucket(): void {
  if (!R2_BUCKET) {
    throw new AppError(422, 'document_storage_unavailable', {
      message: 'Document storage is not configured. Ask an admin to set it up.',
    })
  }
}

/**
 * Attach (or replace) the Supporting Document on the instructor's OWN request.
 *
 * The row is fetched by id AND instructor, so there is no request but their own to
 * attach to. What the file may be is `rules.checkSupportingDocument`'s call, and
 * the key is written only after the object is safely in the bucket — a failed
 * upload leaves the row pointing at nothing rather than at a missing object.
 */
export async function attachSupportingDocument(input: {
  instructorId: string
  id: string
  contentType: string
  bytes: Uint8Array
}): Promise<LeaveRequestRow> {
  const [row] = await db
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.id, input.id), eq(leaveRequests.instructorId, input.instructorId)))
    .limit(1)
  if (!row) throw new NotFoundError('leave_request_not_found')

  const check = rules.checkSupportingDocument({
    leaveType: row.type,
    contentType: input.contentType,
    size: input.bytes.byteLength,
  })
  if (!check.ok) throw new BadRequestError(check.code, { message: check.message })
  requireBucket()

  const key = rules.supportingDocumentKey(row.instructorId, row.id, check.extension)
  await putObject(key, input.bytes, input.contentType)

  const [updated] = await db
    .update(leaveRequests)
    .set({ supportingDocumentR2Key: key, updatedAt: new Date() })
    .where(eq(leaveRequests.id, row.id))
    .returning()
  if (!updated) throw new NotFoundError('leave_request_not_found')
  return updated
}

/**
 * A short-lived signed GET for one Supporting Document.
 *
 * Same visibility rule as the calendar read (`listLeaveCalendar`): an admin or
 * superadmin sees any of them, an instructor only their own. The ownership check
 * comes BEFORE the "is there one" check, so a colleague cannot even learn
 * whether a Supporting Document exists.
 */
export async function supportingDocumentUrl(
  viewer: LeaveCalendarViewer,
  id: string,
): Promise<{ url: string; expires_in: number }> {
  const [row] = await db
    .select({ instructorId: leaveRequests.instructorId, key: leaveRequests.supportingDocumentR2Key })
    .from(leaveRequests)
    .where(eq(leaveRequests.id, id))
    .limit(1)
  if (!row) throw new NotFoundError('leave_request_not_found')
  if (viewer.role === 'instructor' && row.instructorId !== viewer.staffUserId) {
    throw new ForbiddenError('leave_not_yours', {
      message: 'A Supporting Document is visible to its own instructor and to admins only.',
    })
  }
  if (!row.key) throw new NotFoundError('document_not_found')
  requireBucket()

  return {
    url: await signedObjectUrl(row.key, SUPPORTING_DOCUMENT_URL_TTL_SECONDS),
    expires_in: SUPPORTING_DOCUMENT_URL_TTL_SECONDS,
  }
}

// ── The admin's queue ──────────────────────────────────────────────────────

export interface AdminLeaveRequest {
  row: LeaveRequestRow
  instructor: { id: string; name: string; email: string }
}

/** Every instructor's requests, latest dates first (same order as the
 *  instructor's own list). `status` omitted means all of them. */
export async function listLeaveRequestsForAdmin(
  status?: rules.LeaveStatus,
): Promise<AdminLeaveRequest[]> {
  return db
    .select({
      row: leaveRequests,
      instructor: { id: staffUsers.id, name: staffUsers.name, email: staffUsers.email },
    })
    .from(leaveRequests)
    .innerJoin(staffUsers, eq(staffUsers.id, leaveRequests.instructorId))
    .where(status ? eq(leaveRequests.status, status) : undefined)
    .orderBy(desc(leaveRequests.startDate), desc(leaveRequests.createdAt))
}

// ── The all-staff calendar ─────────────────────────────────────────────────

/**
 * One absence on the calendar every staff member can see.
 *
 * The restricted fields live inside `detail`, which is null unless the viewer is
 * allowed all of them. Redaction is therefore structural: there is no shape in
 * which a colleague's leave type or reason can reach an instructor caller, and
 * no frontend is trusted to hide anything.
 */
export interface LeaveCalendarEntry {
  id: string
  instructor: { id: string; name: string }
  start_date: rules.PlainDate
  end_date: rules.PlainDate
  half_day: LeaveRequestRow['halfDay']
  /** Only ever `pending` or `approved` — see the query below. */
  status: rules.LeaveStatus
  /** Admins and superadmins on every row; an instructor on their own rows only. */
  detail: {
    type: rules.LeaveType
    days: number
    reason: string
    decision_reason: string | null
    decided_by: string | null
    /** Whether there is a Supporting Document, never its key — as the admin queue.
     *  Reading one goes through `supportingDocumentUrl`, which checks ownership. */
    has_supporting_document: boolean
  } | null
}

export interface LeaveCalendarViewer {
  staffUserId: string
  role: 'superadmin' | 'admin' | 'instructor'
}

/** The caller as every leave read wants him. Assembled here, next to the type,
 *  so the three leave routes don't each rebuild the same pair of fields. */
export const leaveViewer = (staff: typeof staffUsers.$inferSelect): LeaveCalendarViewer => ({
  staffUserId: staff.id,
  role: staff.role,
})

/**
 * Who is away between `from` and `to`, inclusive.
 *
 * Only leave that is an actual absence shows up: `COMMITTED_STATUSES` is the
 * same pending+approved pair Remaining counts and the scheduler blocks on, so
 * rejected, withdrawn, cancelled and revoked rows can never render as absences.
 */
export async function listLeaveCalendar(
  viewer: LeaveCalendarViewer,
  from: rules.PlainDate,
  to: rules.PlainDate,
): Promise<LeaveCalendarEntry[]> {
  const decider = alias(staffUsers, 'decider')
  const rows = await db
    .select({
      row: leaveRequests,
      instructorName: staffUsers.name,
      deciderName: decider.name,
    })
    .from(leaveRequests)
    .innerJoin(staffUsers, eq(staffUsers.id, leaveRequests.instructorId))
    .leftJoin(decider, eq(decider.id, leaveRequests.decidedByStaffId))
    .where(
      and(
        inArray(leaveRequests.status, [...rules.COMMITTED_STATUSES]),
        // Overlaps the window: starts before it ends, ends after it starts.
        lte(leaveRequests.startDate, to),
        gte(leaveRequests.endDate, from),
      ),
    )
    .orderBy(asc(leaveRequests.startDate), asc(staffUsers.name))

  const seesEverything = viewer.role !== 'instructor'

  return rows.map(({ row, instructorName, deciderName }) => ({
    id: row.id,
    instructor: { id: row.instructorId, name: instructorName },
    start_date: row.startDate,
    end_date: row.endDate,
    half_day: row.halfDay,
    status: row.status,
    detail:
      seesEverything || row.instructorId === viewer.staffUserId
        ? {
            type: row.type,
            days: Number(row.days),
            reason: row.reason,
            decision_reason: row.decisionReason,
            decided_by: deciderName,
            has_supporting_document: row.supportingDocumentR2Key !== null,
          }
        : null,
  }))
}

export interface DecideLeaveInput {
  action: rules.AdminLeaveAction
  id: string
  /** The deciding admin — recorded on the row and used as the audit actor. */
  actorStaffId: string
  /** Mandatory for a rejection: it is what the instructor is told and emailed. */
  reason?: string
}

/**
 * Approve, reject or revoke — the admin's three transitions.
 *
 * Whether the transition is allowed is `rules.checkAdminLeaveDecision`'s call;
 * this only fetches the row, writes the outcome and tells the instructor. No
 * Pool is touched on any path — see the note on the rule.
 */
export async function decideLeaveRequest(input: DecideLeaveInput): Promise<LeaveRequestRow> {
  const reason = input.reason?.trim() ?? ''
  // Checked in the service, not the route, so no future caller can reject
  // without saying why.
  if (input.action === 'reject' && !reason) {
    throw new BadRequestError('reason_required', {
      message: 'A rejection needs a reason — the instructor is sent it.',
    })
  }

  const [row] = await db
    .select()
    .from(leaveRequests)
    .where(eq(leaveRequests.id, input.id))
    .limit(1)
  if (!row) throw new NotFoundError('leave_request_not_found')

  const check = rules.checkAdminLeaveDecision(input.action, row, rules.sgToday(new Date()))
  if (!check.ok) throw new ConflictError(check.code, { message: check.message })

  const now = new Date()
  const revoking = input.action === 'revoke'
  const [updated] = await db
    .update(leaveRequests)
    .set(
      // A revocation reverses a decision; it does not replace it. Overwriting
      // the decision columns would erase who approved the leave and when, which
      // is the half of the story a reversal makes MORE worth keeping. Who
      // revoked it is in the audit log, which already records every leave
      // transition (middleware/audit.ts) — so no column, and no migration.
      revoking
        ? { status: check.status, updatedAt: now }
        : {
            status: check.status,
            decisionReason: reason || null,
            decidedByStaffId: input.actorStaffId,
            decidedAt: now,
            updatedAt: now,
          },
    )
    .where(eq(leaveRequests.id, input.id))
    .returning()
  if (!updated) throw new NotFoundError('leave_request_not_found')

  // All three transitions are told to the instructor. A silent revocation is the
  // one way this feature can leave someone expecting a day off that no longer
  // exists, so it names who took it back and when.
  await emailInstructorOfDecision(
    updated,
    reason,
    revoking ? { staffId: input.actorStaffId, at: now } : undefined,
  )
  return updated
}

// ── Notifications ──────────────────────────────────────────────────────────
//
// Both senders run AFTER the row is written and never throw: a request that has
// already been filed or decided must not fail because SMTP — or a missing
// template row on an unseeded database — misbehaved. What they DO do is report
// the failure (shared/logger.ts), so a swallowed send is never a silent one. The
// admin one gets both guarantees from `emailEveryAdmin`, which also owns who
// "the admins" are.

const HALF_DAY_LABEL: Record<LeaveRequestRow['halfDay'], string> = {
  none: '',
  morning: ' (morning)',
  afternoon: ' (afternoon)',
}

/** A half day says which half, so an admin isn't approving a day they think is whole. */
const formatDates = (r: LeaveRequestRow) =>
  (r.startDate === r.endDate
    ? rules.formatLeaveDate(r.startDate)
    : `${rules.formatLeaveDate(r.startDate)} – ${rules.formatLeaveDate(r.endDate)}`) + HALF_DAY_LABEL[r.halfDay]

async function staffName(staffUserId: string, fallback: string): Promise<string> {
  const [staff] = await db
    .select({ name: staffUsers.name })
    .from(staffUsers)
    .where(eq(staffUsers.id, staffUserId))
    .limit(1)
  return staff?.name ?? fallback
}

async function emailAdminsOfSubmission(row: LeaveRequestRow): Promise<void> {
  await emailEveryAdmin(
    'leave_request_submitted',
    async () => ({
      instructor_name: await staffName(row.instructorId, 'An instructor'),
      leave_type: row.type,
      dates: formatDates(row),
      days: String(Number(row.days)),
      reason: row.reason,
    }),
    { leaveRequestId: row.id },
  )
}

/** "…on 10 August 2026 at 15:42" — a revocation is a moment, not just a day:
 *  an instructor may lose and refile leave inside one afternoon. */
const revokedAtFormat = sgFormat('en-GB', { dateStyle: 'long', timeStyle: 'short' })

/** Approved, rejected or revoked — one recipient, one shape. `revokedBy` is set
 *  on a revocation only, and is what that template's extra two lines render. */
async function emailInstructorOfDecision(
  row: LeaveRequestRow,
  reason: string,
  revokedBy?: { staffId: string; at: Date },
): Promise<void> {
  try {
    const [staff] = await db
      .select({ id: staffUsers.id, name: staffUsers.name, email: staffUsers.email })
      .from(staffUsers)
      .where(eq(staffUsers.id, row.instructorId))
      .limit(1)
    if (!staff) return

    await sendTemplatedEmail({
      slug:
        row.status === 'approved'
          ? 'leave_approved'
          : row.status === 'revoked'
            ? 'leave_revoked'
            : 'leave_rejected',
      recipient: { email: staff.email, userId: staff.id, userKind: 'staff' },
      variables: {
        instructor_name: staff.name,
        leave_type: row.type,
        dates: formatDates(row),
        days: String(Number(row.days)),
        reason,
        ...(revokedBy
          ? {
              revoked_by: await staffName(revokedBy.staffId, 'An admin'),
              revoked_at: revokedAtFormat.format(revokedBy.at),
            }
          : {}),
      },
    })
  } catch (err) {
    reportError(err, 'leave decision: instructor notification failed', { leaveRequestId: row.id })
  }
}
