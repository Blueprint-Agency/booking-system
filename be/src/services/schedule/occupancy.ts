import { and, eq, gt, inArray, lt, ne, sql, type AnyColumn } from 'drizzle-orm'
import { db } from '../../db'
import {
  classes,
  corporateSessions,
  workshopDays,
  workshops,
  ptSessions,
} from '../../db/schema/schedule'
import { rooms } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { leaveRequests } from '../../db/schema/leave'
import { leaveWindow, OCCUPYING_STATUSES, type LeaveHalfDay, type PlainDate } from '../leave/rules'
import { zoneFormat } from '../../lib/studio-time'
import { tenantTimezone } from '../tenants/tenants'
import { ConflictError } from '../../shared/errors'
import { mergeRoster } from './roster-merge'
import {
  exec,
  readRoster,
  readRosters,
  type RosterEventKind,
  type RosterPatch,
  type RosterRef,
  type Tx,
} from './roster'

/**
 * Occupancy: is a subject (a room, or an instructor) already taken during a
 * window, across every kind of scheduled event?
 *
 * A room hosts one session at a time and an instructor teaches one session at a
 * time — same question, same answer shape, same refusal. Both are asked through
 * `assertAvailable`, which is the ONLY place a scheduling conflict becomes an
 * error, so a class create and a PT reschedule cannot report the same clash two
 * different ways.
 *
 * An instructor is occupied by every event they are ON, not just the ones they
 * lead: the roster module is the authority on who that is (main AND supporting,
 * for all four kinds), so this module asks it rather than reading a
 * main-instructor column.
 *
 * An instructor is also occupied by their own LEAVE, which is not an event at
 * all: it has no room and nothing schedules it. Expressing it here — rather than
 * in each write path — is what gives class, private-session and corporate
 * create/edit leave enforcement without any of them being touched.
 *
 * The database query only NARROWS candidates (right time, active row, right
 * room). The rule itself lives in the pure functions below, so it can be checked
 * without a database — see occupancy.test.ts.
 */

export type EventKind = 'class' | 'workshop_day' | 'pt_session' | 'corporate_session'

const EVENT_KINDS: EventKind[] = ['class', 'workshop_day', 'pt_session', 'corporate_session']

/** Whose roster answers for an event: a workshop day is staffed by its parent
 *  workshop, the other three carry their own. */
const rosterKindFor: Record<EventKind, RosterEventKind> = {
  class: 'class',
  workshop_day: 'workshop',
  pt_session: 'pt_session',
  corporate_session: 'corporate_session',
}

/** What we're asking about: a physical room, or an instructor's own time. */
export interface OccupancySubject {
  kind: 'room' | 'instructor'
  id: string
}

export interface TimeWindow {
  startsAt: Date
  endsAt: Date
}

/** The event being created or edited — never conflicts with itself. */
export interface EventRef {
  kind: EventKind
  id: string
}

/**
 * What can take a subject's time. Every schedulable event, plus leave — which is
 * NOT an EventKind: no scheduling path creates, edits or excludes a leave
 * request, so it can occupy without being an `EventRef`.
 */
type ConflictKind = EventKind | 'leave'

/** A conflict: what has the subject, and when. Serialised shape (snake_case) is
 *  part of the `schedule_conflict` error payload — do not rename. */
export interface OccupancyConflict {
  kind: ConflictKind
  id: string
  starts_at: string
  ends_at: string
}

/** Two half-open windows [start, end) overlap. Touching endpoints do not. */
export function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt
}

/** The full rule: a candidate event occupies the window unless it IS the event
 *  being edited. Self-exclusion is uniform across all four kinds. */
export function occupies(
  candidate: EventRef & TimeWindow,
  window: TimeWindow,
  exclude?: EventRef,
): boolean {
  if (exclude && exclude.kind === candidate.kind && exclude.id === candidate.id) return false
  return overlaps(candidate, window)
}

/** A leave request as the schedule sees it: an instructor's run of plain days,
 *  possibly only one half of a single day. */
interface LeaveRun {
  id: string
  startDate: PlainDate
  endDate: PlainDate
  halfDay?: LeaveHalfDay
}

/**
 * Leave, as occupancy. Each run becomes the window on the studio's clock it
 * really is — `leaveWindow` is the one place that arithmetic lives, half days
 * included — and then goes through the same overlap rule as every event, so a
 * full day cannot bleed into the adjacent one and a half day leaves the other
 * half of the day bookable. Pure: see occupancy.test.ts.
 */
export function leaveConflicts(
  runs: readonly LeaveRun[],
  window: TimeWindow,
  timezone: string,
): OccupancyConflict[] {
  const found: OccupancyConflict[] = []
  for (const run of runs) {
    const w = leaveWindow(timezone, run.startDate, run.endDate, run.halfDay)
    if (!overlaps(w, window)) continue
    found.push({
      kind: 'leave',
      id: run.id,
      starts_at: w.startsAt.toISOString(),
      ends_at: w.endsAt.toISOString(),
    })
  }
  return found
}

const KIND_LABEL: Record<EventKind, string> = {
  class: 'class',
  workshop_day: 'workshop day',
  pt_session: 'private session',
  corporate_session: 'corporate session',
}

// The studio's clock — the only one an admin reads a schedule in.
const studioDate = (timezone: string) => zoneFormat(timezone, 'en-GB', { day: 'numeric', month: 'short' })
const studioTime = (timezone: string) =>
  zoneFormat(timezone, 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })

/**
 * The days a leave conflict covers, as studio dates: "on 12 Aug", or "from 12
 * Aug to 14 Aug". Exported because the leave submission path builds its own
 * sentence around the same dates (services/leave/requests.ts).
 */
export function leaveDaysPhrase(
  conflict: Pick<OccupancyConflict, 'starts_at' | 'ends_at'>,
  timezone: string,
): string {
  const date = studioDate(timezone)
  const from = new Date(conflict.starts_at)
  // The window is half-open, so the last day it covers ends an instant before.
  const last = new Date(Date.parse(conflict.ends_at) - 1)
  return date.format(from) === date.format(last)
    ? `on ${date.format(from)}`
    : `from ${date.format(from)} to ${date.format(last)}`
}

/**
 * The sentence the portal shows: who is taken, and by what. `who` is the
 * instructor's name or `Room X` — already resolved, so this stays pure and
 * checkable (see occupancy.test.ts).
 *
 * Leave gets its own phrasing: somebody who is away is on leave, not booked, and
 * a whole day has no clock time worth showing.
 */
export function conflictMessage(who: string, conflicts: OccupancyConflict[], timezone: string): string {
  const first = conflicts[0]
  if (!first) return `${who} is not available at that time.`
  const from = new Date(first.starts_at)
  const to = new Date(first.ends_at)
  const more = conflicts.length > 1 ? ` (and ${conflicts.length - 1} more)` : ''
  if (first.kind === 'leave') {
    return `${who} is on leave ${leaveDaysPhrase(first, timezone)}${more}.`
  }
  return (
    `${who} is already booked — a ${KIND_LABEL[first.kind]} on ${studioDate(timezone).format(from)}, ` +
    `${studioTime(timezone).format(from)}–${studioTime(timezone).format(to)}${more}.`
  )
}

type Candidate = OccupancyConflict & { rosterId: string }

/**
 * Every active event of every kind that occupies `subject` during `window`,
 * excluding the event identified by `exclude` (the one being rescheduled).
 * Empty array = free.
 *
 * "Active" is expressed differently per table: classes, pt_sessions and
 * corporate_sessions each carry their own `lifecycle`; workshop_days have none
 * and inherit it from the parent workshop.
 */
export async function findOccupancyConflicts(
  tenantId: string,
  asked: OccupancySubject,
  window: TimeWindow,
  exclude?: EventRef,
  tx?: Tx,
): Promise<OccupancyConflict[]> {
  const subject = canonical(asked)
  const excludeId = (kind: EventKind) => (exclude?.kind === kind ? exclude.id : undefined)
  // SQL-side narrowing only: right time-ish, not itself. The rule is `occupies`.
  const narrow = (kind: EventKind, startsAt: AnyColumn, endsAt: AnyColumn, id: AnyColumn) => {
    const conds = [lt(startsAt, window.endsAt), gt(endsAt, window.startsAt)]
    const skip = excludeId(kind)
    if (skip) conds.push(ne(id, skip))
    return conds
  }
  /** A room is a column on every event; an instructor is a roster, resolved below. */
  const inRoom = (roomId: AnyColumn) => (subject.kind === 'room' ? [eq(roomId, subject.id)] : [])

  const found: Candidate[] = []
  const collect = (kind: EventKind, rows: (TimeWindow & { id: string; rosterId: string })[]) => {
    for (const r of rows) {
      if (occupies({ kind, id: r.id, startsAt: r.startsAt, endsAt: r.endsAt }, window, exclude)) {
        found.push({
          kind,
          id: r.id,
          rosterId: r.rosterId,
          starts_at: r.startsAt.toISOString(),
          ends_at: r.endsAt.toISOString(),
        })
      }
    }
  }

  // ---- classes ----
  collect(
    'class',
    await exec(tx)
      .select({
        id: classes.id,
        startsAt: classes.startsAt,
        endsAt: classes.endsAt,
        rosterId: classes.id,
      })
      .from(classes)
      .where(
        and(
          // Occupancy is a fact about one studio's premises and people: another
          // tenant's class in another tenant's room takes nothing from this one.
          eq(classes.tenantId, tenantId),
          ...inRoom(classes.roomId),
          eq(classes.lifecycle, 'active'),
          ...narrow('class', classes.startsAt, classes.endsAt, classes.id),
        ),
      ),
  )

  // ---- workshop days (no lifecycle of their own — the parent workshop's) ----
  collect(
    'workshop_day',
    await exec(tx)
      .select({
        id: workshopDays.id,
        startsAt: workshopDays.startsAt,
        endsAt: workshopDays.endsAt,
        // Staffing hangs off the workshop, so that is the roster to ask about.
        rosterId: workshopDays.workshopId,
      })
      .from(workshopDays)
      .innerJoin(workshops, eq(workshops.id, workshopDays.workshopId))
      .where(
        and(
          eq(workshopDays.tenantId, tenantId),
          ...inRoom(workshopDays.roomId),
          eq(workshops.lifecycle, 'active'),
          ...narrow('workshop_day', workshopDays.startsAt, workshopDays.endsAt, workshopDays.id),
        ),
      ),
  )

  // ---- pt sessions ----
  collect(
    'pt_session',
    await exec(tx)
      .select({
        id: ptSessions.id,
        startsAt: ptSessions.startsAt,
        endsAt: ptSessions.endsAt,
        rosterId: ptSessions.id,
      })
      .from(ptSessions)
      .where(
        and(
          eq(ptSessions.tenantId, tenantId),
          ...inRoom(ptSessions.roomId),
          eq(ptSessions.lifecycle, 'active'),
          ...narrow('pt_session', ptSessions.startsAt, ptSessions.endsAt, ptSessions.id),
        ),
      ),
  )

  // ---- corporate sessions ----
  collect(
    'corporate_session',
    await exec(tx)
      .select({
        id: corporateSessions.id,
        startsAt: corporateSessions.startsAt,
        endsAt: corporateSessions.endsAt,
        rosterId: corporateSessions.id,
      })
      .from(corporateSessions)
      .where(
        and(
          eq(corporateSessions.tenantId, tenantId),
          ...inRoom(corporateSessions.roomId),
          eq(corporateSessions.lifecycle, 'active'),
          ...narrow(
            'corporate_session',
            corporateSessions.startsAt,
            corporateSessions.endsAt,
            corporateSessions.id,
          ),
        ),
      ),
  )

  const strip = ({ rosterId: _rosterId, ...conflict }: Candidate): OccupancyConflict => conflict
  if (subject.kind === 'room') return found.map(strip)

  // ---- leave ----
  // Below the room short-circuit on purpose: leave has no room, so a room query
  // can never reach it. Pending counts as well as approved, so a request cannot
  // become impossible to approve in the gap before the decision.
  // ponytail: reads one instructor's pending+approved rows and lets the pure
  // rule decide — tens of rows. Narrow by date in SQL if that ever grows.
  // A leave day is a day on the studio's clock, so the rule is handed its zone.
  const occupied: OccupancyConflict[] = leaveConflicts(
    await exec(tx)
      .select({
        id: leaveRequests.id,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        halfDay: leaveRequests.halfDay,
      })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.tenantId, tenantId),
          eq(leaveRequests.staffUserId, subject.id),
          inArray(leaveRequests.status, [...OCCUPYING_STATUSES]),
        ),
      ),
    window,
    await tenantTimezone(tenantId),
  )

  // An instructor's events aren't a column — ask the roster who is on each
  // candidate, main and supporting alike.
  // ponytail: candidates are narrowed by time only, so this reads the rosters of
  // every active event overlapping the window (a handful, for one studio hour).
  // Push the instructor filter into SQL if that ever stops being a handful.
  for (const kind of EVENT_KINDS) {
    const rows = found.filter(f => f.kind === kind)
    if (rows.length === 0) continue
    const rosters = await readRosters(
      tenantId,
      rosterKindFor[kind],
      [...new Set(rows.map(r => r.rosterId))],
      tx,
    )
    for (const row of rows) {
      if (rosters.get(row.rosterId)?.some(e => e.instructorId === subject.id)) {
        occupied.push(strip(row))
      }
    }
  }
  return occupied
}

/** Room name / instructor name for the refusal message. Failure path only. */
async function subjectLabel(tenantId: string, subject: OccupancySubject, tx?: Tx): Promise<string> {
  if (subject.kind === 'room') {
    const [room] = await exec(tx)
      .select({ name: rooms.name })
      .from(rooms)
      .where(and(eq(rooms.tenantId, tenantId), eq(rooms.id, subject.id)))
      .limit(1)
    return room ? `Room ${room.name}` : 'That room'
  }
  const [staff] = await exec(tx)
    .select({ name: staffUsers.name })
    .from(staffUsers)
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, subject.id)))
    .limit(1)
  return staff?.name ?? 'That instructor'
}

/** A busy subject: the `schedule_conflict` error payload. Serialised as-is — do not rename. */
export interface SubjectClash {
  subject: OccupancySubject['kind']
  subject_id: string
  message: string
  conflicts: OccupancyConflict[]
}

/**
 * The clash `assertAvailable` would refuse with, returned rather than thrown —
 * for a caller asking about many windows at once (a Class Series preview), which
 * has to report every clash instead of stopping at the first. Null = free.
 */
export async function findClash(
  tenantId: string,
  asked: OccupancySubject,
  window: TimeWindow,
  exclude?: EventRef,
  tx?: Tx,
): Promise<SubjectClash | null> {
  const subject = canonical(asked)
  const conflicts = await findOccupancyConflicts(tenantId, subject, window, exclude, tx)
  if (conflicts.length === 0) return null
  return {
    subject: subject.kind,
    subject_id: subject.id,
    message: conflictMessage(
      await subjectLabel(tenantId, subject, tx),
      conflicts,
      await tenantTimezone(tenantId),
    ),
    conflicts,
  }
}

export function eventSubjects(roomId: string | null | undefined, instructorIds: readonly string[]): OccupancySubject[] {
  return [
    ...(roomId ? [{ kind: 'room' as const, id: roomId }] : []),
    ...[...new Set(instructorIds)].map(id => ({ kind: 'instructor' as const, id })),
  ]
}

function canonical(subject: OccupancySubject): OccupancySubject {
  return { kind: subject.kind, id: subject.id.toLowerCase() }
}

/**
 * Hold these rooms and instructors for the rest of the transaction: a second
 * write for one of them waits here until the first commits, then sees it.
 *
 * Take it before any other lock but the event's own row (the class, the PT
 * request and session, the series, the workshop), with every subject the
 * transaction will claim, all at once. The locks are taken in the order of
 * their lock ids, so two writes cannot deadlock on each other, nor with what
 * is locked after this: the instructor rows a leave submission locks, member
 * time, packages. A later call for subjects already held returns at once.
 */
export async function lockOccupancy(tx: Tx, tenantId: string, subjects: readonly OccupancySubject[]): Promise<void> {
  if (subjects.length === 0) return
  const keys = subjects.map(s => {
    const { kind, id } = canonical(s)
    return sql`(${`occupancy:${tenantId.toLowerCase()}:${kind}:${id}`})`
  })
  const locks = await tx.execute<{ lock: number }>(
    sql`select distinct hashtext(v.key) as lock from (values ${sql.join(keys, sql`, `)}) as v(key) order by lock`,
  )
  for (const { lock } of locks) await tx.execute(sql`select pg_advisory_xact_lock(${lock}::bigint)`)
}

/**
 * Refuse the write if any subject is busy, holding them all first
 * (`lockOccupancy`). One error identity — `schedule_conflict` — for rooms and
 * instructors alike, carrying which subject was taken, a ready-made sentence,
 * and the conflicting events.
 *
 * Pass `exclude` when rescheduling so a row doesn't clash with itself.
 */
export async function assertAvailable(
  tx: Tx,
  tenantId: string,
  subjects: readonly OccupancySubject[],
  window: TimeWindow,
  exclude?: EventRef,
): Promise<void> {
  await lockOccupancy(tx, tenantId, subjects)
  for (const subject of subjects) {
    const clash = await findClash(tenantId, subject, window, exclude, tx)
    if (clash) throw new ConflictError('schedule_conflict', { ...clash })
  }
}

/**
 * The instructors an event will carry once `patch` is applied — the same merge
 * the write performs, so the availability check can't disagree with what gets
 * saved. An empty patch means "whoever is on it today".
 *
 * A patch the merge refuses yields no ids: `replaceRoster` is where that refusal
 * belongs, and there is nothing coherent to check in the meantime.
 */
export async function plannedInstructorIds(
  tenantId: string,
  ref: RosterRef,
  patch: RosterPatch = {},
): Promise<string[]> {
  const merged = mergeRoster(await readRoster(tenantId, ref), patch)
  return merged.ok ? merged.roster.map(r => r.instructorId) : []
}
