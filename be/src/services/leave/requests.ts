import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../../db'
import { leaveRequests } from '../../db/schema/leave'
import { instructors } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { readPolicy } from '../policy/update'
import { conflictMessage, findOccupancyConflicts, leaveDaysPhrase } from '../schedule/occupancy'
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

export interface LeaveBalance {
  type: rules.LeaveType
  allowance: number
  /** Approved days — what has actually been taken. */
  taken_days: number
  /** Awaiting a decision. Counted against a new submission, not against `taken`. */
  pending_days: number
  /** allowance − taken. */
  remaining_days: number
}

/** numeric(4,1) comes back as a string. */
const toDaysRow = (r: LeaveRequestRow): rules.LeaveDaysRow => ({
  type: r.type,
  leaveYear: r.leaveYear,
  status: r.status,
  days: Number(r.days),
})

async function allowances(): Promise<Record<rules.LeaveType, number>> {
  const { global_policy } = await readPolicy()
  return { annual: global_policy.annualLeaveDays, medical: global_policy.medicalLeaveDays }
}

function balances(
  allowance: Record<rules.LeaveType, number>,
  rows: rules.LeaveDaysRow[],
  leaveYear: number,
): LeaveBalance[] {
  return (['annual', 'medical'] as const).map(type => {
    const scope = { type, leaveYear }
    const taken = rules.sumLeaveDays(rows, { ...scope, statuses: rules.TAKEN_STATUSES })
    const committed = rules.sumLeaveDays(rows, { ...scope, statuses: rules.COMMITTED_STATUSES })
    return {
      type,
      allowance: allowance[type],
      taken_days: taken,
      pending_days: committed - taken,
      remaining_days: allowance[type] - taken,
    }
  })
}

/** The instructor's own page: both balances for `leaveYear`, plus their whole
 *  history (all years — the balances are the year-scoped part).
 *
 *  Which year "no year" means is a domain question, so it is answered here and
 *  not in the route: the leave year the Singapore-local today falls in. */
export async function getOwnLeave(
  instructorId: string,
  leaveYear = rules.leaveYearOf(rules.sgToday(new Date())),
): Promise<{ leave_year: number; balances: LeaveBalance[]; requests: LeaveRequestRow[] }> {
  const rows = await db
    .select()
    .from(leaveRequests)
    .where(eq(leaveRequests.instructorId, instructorId))
    .orderBy(desc(leaveRequests.startDate), desc(leaveRequests.createdAt))
  return {
    leave_year: leaveYear,
    balances: balances(await allowances(), rows.map(toDaysRow), leaveYear),
    requests: rows,
  }
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
 * The balance read, the clash check and the insert are one transaction,
 * serialised per instructor by locking that instructor's OWN row as the first
 * statement in it. Without that, two requests that each fit the remaining
 * balance can both read the same "before" and both be accepted — the very
 * over-commitment "pending counts against your balance" exists to stop.
 *
 * The lock is on `instructors`, not on the leave rows: what has to be kept out
 * is a row that does not exist yet, and an absent row cannot be locked. It is
 * one row per instructor, so two instructors never wait on each other.
 */
export async function submitLeaveRequest(input: SubmitLeaveInput): Promise<LeaveRequestRow> {
  const now = new Date()
  const leaveYear = rules.leaveYearOf(input.startDate)
  const halfDay = input.halfDay ?? 'none'
  // Global policy, not this instructor's — read before the lock is taken so
  // nothing but the instructor's own rows is held under it.
  const allowance = await allowances()

  const row = await db.transaction(async tx => {
    // FIRST statement, and the reason there is a transaction at all. Leave is
    // also an instructor thing: admins and superadmins have no instructors row
    // and their absence has no effect on the schedule, so the same select is
    // the permission check.
    const [isInstructor] = await tx
      .select({ id: instructors.staffUserId })
      .from(instructors)
      .where(eq(instructors.staffUserId, input.instructorId))
      .for('update')
      .limit(1)
    if (!isInstructor) throw new ForbiddenError('not_an_instructor')

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
      allowance: allowance[input.type],
      committedDays: rules.sumLeaveDays(existing.map(toDaysRow), {
        type: input.type,
        leaveYear,
        statuses: rules.COMMITTED_STATUSES,
      }),
    })
    if (!check.ok) throw new BadRequestError(check.code, { message: check.message })

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
 *  Both give the days back with no arithmetic: the balance is a sum over rows. */
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

// ── The medical certificate ────────────────────────────────────────────────

/** How long a signed link lives. Long enough to open, short enough that a copied
 *  URL in a chat window is worthless by the time anyone tries it. */
export const MEDICAL_CERT_URL_TTL_SECONDS = 300

/** The bucket is optional in env (see lib/r2.ts), so both paths say so
 *  plainly rather than failing as an unexplained 500. */
function requireBucket(): void {
  if (!R2_BUCKET) {
    throw new AppError(422, 'certificate_storage_unavailable', {
      message: 'Certificate storage is not configured. Ask an admin to set it up.',
    })
  }
}

/**
 * Attach (or replace) the certificate on the instructor's OWN medical request.
 *
 * The row is fetched by id AND instructor, so there is no request but their own to
 * attach to. What the file may be is `rules.checkMedicalCertificate`'s call, and
 * the key is written only after the object is safely in the bucket — a failed
 * upload leaves the row pointing at nothing rather than at a missing object.
 */
export async function attachMedicalCertificate(input: {
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

  const check = rules.checkMedicalCertificate({
    leaveType: row.type,
    contentType: input.contentType,
    size: input.bytes.byteLength,
  })
  if (!check.ok) throw new BadRequestError(check.code, { message: check.message })
  requireBucket()

  const key = rules.medicalCertKey(row.instructorId, row.id, check.extension)
  await putObject(key, input.bytes, input.contentType)

  const [updated] = await db
    .update(leaveRequests)
    .set({ medicalCertR2Key: key, updatedAt: new Date() })
    .where(eq(leaveRequests.id, row.id))
    .returning()
  if (!updated) throw new NotFoundError('leave_request_not_found')
  return updated
}

/**
 * A short-lived signed GET for one certificate.
 *
 * Same visibility rule as the calendar read (`listLeaveCalendar`): an admin or
 * superadmin sees any of them, an instructor only their own. The ownership check
 * comes BEFORE the "is there one" check, so a colleague cannot even learn
 * whether a certificate exists.
 */
export async function medicalCertificateUrl(
  viewer: LeaveCalendarViewer,
  id: string,
): Promise<{ url: string; expires_in: number }> {
  const [row] = await db
    .select({ instructorId: leaveRequests.instructorId, key: leaveRequests.medicalCertR2Key })
    .from(leaveRequests)
    .where(eq(leaveRequests.id, id))
    .limit(1)
  if (!row) throw new NotFoundError('leave_request_not_found')
  if (viewer.role === 'instructor' && row.instructorId !== viewer.staffUserId) {
    throw new ForbiddenError('leave_not_yours', {
      message: 'A medical certificate is visible to its own instructor and to admins only.',
    })
  }
  if (!row.key) throw new NotFoundError('certificate_not_found')
  requireBucket()

  return {
    url: await signedObjectUrl(row.key, MEDICAL_CERT_URL_TTL_SECONDS),
    expires_in: MEDICAL_CERT_URL_TTL_SECONDS,
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
    /** Whether there is a certificate, never its key — same as the admin queue.
     *  Reading one goes through `medicalCertificateUrl`, which checks ownership. */
    has_certificate: boolean
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
 * same pending+approved pair the balance counts and the scheduler blocks on, so
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
            has_certificate: row.medicalCertR2Key !== null,
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
 * balance is touched on any path — see the note on the rule.
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A plain date read as itself. Never parsed as an instant, so nothing shifts. */
const formatDay = (d: rules.PlainDate) =>
  `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`

const HALF_DAY_LABEL: Record<LeaveRequestRow['halfDay'], string> = {
  none: '',
  morning: ' (morning)',
  afternoon: ' (afternoon)',
}

/** A half day says which half, so an admin isn't approving a day they think is whole. */
const formatDates = (r: LeaveRequestRow) =>
  (r.startDate === r.endDate
    ? formatDay(r.startDate)
    : `${formatDay(r.startDate)} – ${formatDay(r.endDate)}`) + HALF_DAY_LABEL[r.halfDay]

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
