import { and, eq, gt, lt, ne, type AnyColumn } from 'drizzle-orm'
import { db } from '../../db'
import {
  classes,
  corporateSessions,
  workshopDays,
  workshopInstructors,
  workshops,
  ptSessions,
} from '../../db/schema/schedule'

/**
 * Occupancy: is a subject (a room, or an instructor) already taken during a
 * window, across every kind of scheduled event?
 *
 * The database query only NARROWS candidates (right subject, active row, roughly
 * the right time). The rule itself lives in the pure functions below, so it can
 * be checked without a database — see occupancy.test.ts.
 */

export type EventKind = 'class' | 'workshop_day' | 'pt_session' | 'corporate_session'

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
 *  part of the `room_clash` error payload — do not rename. */
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

type Row = { id: string; startsAt: Date; endsAt: Date }

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

  const found: OccupancyConflict[] = []
  const collect = (kind: EventKind, rows: Row[]) => {
    for (const r of rows) {
      if (occupies({ kind, id: r.id, startsAt: r.startsAt, endsAt: r.endsAt }, window, exclude)) {
        found.push({
          kind,
          id: r.id,
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
      .select({ id: classes.id, startsAt: classes.startsAt, endsAt: classes.endsAt })
      .from(classes)
      .where(
        and(
          subject.kind === 'room'
            ? eq(classes.roomId, subject.id)
            : eq(classes.mainInstructorId, subject.id),
          eq(classes.lifecycle, 'active'),
          ...narrow('class', classes.startsAt, classes.endsAt, classes.id),
        ),
      ),
  )

  // ---- workshop days (no lifecycle of their own — the parent workshop's) ----
  const dayCols = {
    id: workshopDays.id,
    startsAt: workshopDays.startsAt,
    endsAt: workshopDays.endsAt,
  }
  const dayConds = [
    eq(workshops.lifecycle, 'active'),
    ...narrow('workshop_day', workshopDays.startsAt, workshopDays.endsAt, workshopDays.id),
  ]
  const dayQuery = db
    .select(dayCols)
    .from(workshopDays)
    .innerJoin(workshops, eq(workshops.id, workshopDays.workshopId))
  collect(
    'workshop_day',
    subject.kind === 'room'
      ? await dayQuery.where(and(eq(workshopDays.roomId, subject.id), ...dayConds))
      : // Only the main instructor's own time is blocked; supporting roles don't.
        await dayQuery
          .innerJoin(
            workshopInstructors,
            and(
              eq(workshopInstructors.workshopId, workshops.id),
              eq(workshopInstructors.role, 'main'),
              eq(workshopInstructors.instructorId, subject.id),
            ),
          )
          .where(and(...dayConds)),
  )

  // ---- pt sessions ----
  collect(
    'pt_session',
    await db
      .select({ id: ptSessions.id, startsAt: ptSessions.startsAt, endsAt: ptSessions.endsAt })
      .from(ptSessions)
      .where(
        and(
          subject.kind === 'room'
            ? eq(ptSessions.roomId, subject.id)
            : eq(ptSessions.instructorId, subject.id),
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
      })
      .from(corporateSessions)
      .where(
        and(
          subject.kind === 'room'
            ? eq(corporateSessions.roomId, subject.id)
            : eq(corporateSessions.mainInstructorId, subject.id),
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

  return found
}
