import { and, eq, gt, lt, ne, type AnyColumn } from 'drizzle-orm'
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
import { ConflictError } from '../../shared/errors'
import { mergeRoster } from './roster-merge'
import { readRoster, readRosters, type RosterEventKind, type RosterPatch, type RosterRef } from './roster'

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

/** A conflicting event: which one, and when. Serialised shape (snake_case) is
 *  part of the `schedule_conflict` error payload — do not rename. */
export interface OccupancyConflict {
  kind: EventKind
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

const KIND_LABEL: Record<EventKind, string> = {
  class: 'class',
  workshop_day: 'workshop day',
  pt_session: 'private session',
  corporate_session: 'corporate session',
}

// Studio time — the only clock an admin reads a schedule in.
const sgDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore',
  day: 'numeric',
  month: 'short',
})
const sgTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/**
 * The sentence the portal shows: who is taken, and by which event. `who` is the
 * instructor's name or `Room X` — already resolved, so this stays pure and
 * checkable (see occupancy.test.ts).
 */
export function conflictMessage(who: string, conflicts: OccupancyConflict[]): string {
  const first = conflicts[0]
  if (!first) return `${who} is not available at that time.`
  const from = new Date(first.starts_at)
  const to = new Date(first.ends_at)
  const more = conflicts.length > 1 ? ` (and ${conflicts.length - 1} more)` : ''
  return (
    `${who} is already booked — a ${KIND_LABEL[first.kind]} on ${sgDate.format(from)}, ` +
    `${sgTime.format(from)}–${sgTime.format(to)}${more}.`
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
  subject: OccupancySubject,
  window: TimeWindow,
  exclude?: EventRef,
): Promise<OccupancyConflict[]> {
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
    await db
      .select({
        id: classes.id,
        startsAt: classes.startsAt,
        endsAt: classes.endsAt,
        rosterId: classes.id,
      })
      .from(classes)
      .where(
        and(
          ...inRoom(classes.roomId),
          eq(classes.lifecycle, 'active'),
          ...narrow('class', classes.startsAt, classes.endsAt, classes.id),
        ),
      ),
  )

  // ---- workshop days (no lifecycle of their own — the parent workshop's) ----
  collect(
    'workshop_day',
    await db
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
          ...inRoom(workshopDays.roomId),
          eq(workshops.lifecycle, 'active'),
          ...narrow('workshop_day', workshopDays.startsAt, workshopDays.endsAt, workshopDays.id),
        ),
      ),
  )

  // ---- pt sessions ----
  collect(
    'pt_session',
    await db
      .select({
        id: ptSessions.id,
        startsAt: ptSessions.startsAt,
        endsAt: ptSessions.endsAt,
        rosterId: ptSessions.id,
      })
      .from(ptSessions)
      .where(
        and(
          ...inRoom(ptSessions.roomId),
          eq(ptSessions.lifecycle, 'active'),
          ...narrow('pt_session', ptSessions.startsAt, ptSessions.endsAt, ptSessions.id),
        ),
      ),
  )

  // ---- corporate sessions ----
  collect(
    'corporate_session',
    await db
      .select({
        id: corporateSessions.id,
        startsAt: corporateSessions.startsAt,
        endsAt: corporateSessions.endsAt,
        rosterId: corporateSessions.id,
      })
      .from(corporateSessions)
      .where(
        and(
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

  // An instructor's events aren't a column — ask the roster who is on each
  // candidate, main and supporting alike.
  // ponytail: candidates are narrowed by time only, so this reads the rosters of
  // every active event overlapping the window (a handful, for one studio hour).
  // Push the instructor filter into SQL if that ever stops being a handful.
  const occupied: OccupancyConflict[] = []
  for (const kind of EVENT_KINDS) {
    const rows = found.filter(f => f.kind === kind)
    if (rows.length === 0) continue
    const rosters = await readRosters(rosterKindFor[kind], [...new Set(rows.map(r => r.rosterId))])
    for (const row of rows) {
      if (rosters.get(row.rosterId)?.some(e => e.instructorId === subject.id)) {
        occupied.push(strip(row))
      }
    }
  }
  return occupied
}

/** Room name / instructor name for the refusal message. Failure path only. */
async function subjectLabel(subject: OccupancySubject): Promise<string> {
  if (subject.kind === 'room') {
    const [room] = await db
      .select({ name: rooms.name })
      .from(rooms)
      .where(eq(rooms.id, subject.id))
      .limit(1)
    return room ? `Room ${room.name}` : 'That room'
  }
  const [staff] = await db
    .select({ name: staffUsers.name })
    .from(staffUsers)
    .where(eq(staffUsers.id, subject.id))
    .limit(1)
  return staff?.name ?? 'That instructor'
}

/**
 * Refuse the write if the subject is busy. One error identity — `schedule_conflict`
 * — for rooms and instructors alike, carrying which subject was taken, a
 * ready-made sentence, and the conflicting events.
 *
 * Pass `exclude` when rescheduling so a row doesn't clash with itself.
 */
export async function assertAvailable(
  subject: OccupancySubject,
  window: TimeWindow,
  exclude?: EventRef,
): Promise<void> {
  const conflicts = await findOccupancyConflicts(subject, window, exclude)
  if (conflicts.length === 0) return
  throw new ConflictError('schedule_conflict', {
    subject: subject.kind,
    subject_id: subject.id,
    message: conflictMessage(await subjectLabel(subject), conflicts),
    conflicts,
  })
}

/** Everyone being put on the event has to be free, not just whoever leads it. */
export async function assertInstructorsAvailable(
  instructorIds: string[],
  window: TimeWindow,
  exclude?: EventRef,
): Promise<void> {
  // ponytail: one scan per instructor — a roster is one to three people. Batch
  // by instructor id if a roster ever gets long.
  for (const id of new Set(instructorIds)) {
    await assertAvailable({ kind: 'instructor', id }, window, exclude)
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
  ref: RosterRef,
  patch: RosterPatch = {},
): Promise<string[]> {
  const merged = mergeRoster(await readRoster(ref), patch)
  return merged.ok ? merged.roster.map(r => r.instructorId) : []
}
