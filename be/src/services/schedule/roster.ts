/**
 * The roster — the ONLY code that writes who is assigned to a scheduled event
 * and what each of them is paid for it.
 *
 * Why it exists: pay for a supporting instructor is entered on the Payroll
 * screen, but the roster was rewritten wholesale from the Schedule screen —
 * `delete … where class_id = ?` followed by an insert of every row with
 * `pay_sgd = NULL`. Pricing an instructor on one screen was silently undone by
 * an unrelated edit on another, and the next payroll run under-reported them.
 * Every roster write now goes through `replaceRoster`, which merges (see
 * `./roster-merge.ts`), so pay can't be lost as a side effect again.
 *
 * Contract:
 *   - `replaceRoster` takes the caller's transaction handle — it NEVER opens its
 *     own, so the roster commits or rolls back with the event change that caused it.
 *   - Storage shape is implementation: pay is `numeric(10,2)` in the DB and a
 *     plain SGD number here; for classes/PT/corporate the main instructor is a
 *     column on the event while workshops model it as a `role='main'` row.
 *     Corporate sessions carry no pay columns at all, so everyone on one reads
 *     back unpriced. Callers see one shape — a list of `RosterEntry`.
 *   - Deduplication and the main-cannot-also-be-supporting rule are enforced in
 *     the merge, not by callers.
 *
 * All four event kinds are here, and nothing outside this module writes an
 * assignment row or a pay column — `payroll/list.ts` prices through
 * `setInstructorPay`. Payroll still READS those tables directly; it needs the
 * joins, the completed-window filter and the name lookups, which are its own
 * business.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db'
import {
  classes,
  classSupportingInstructors,
  corporateSessions,
  corporateSessionSupportingInstructors,
  ptSessions,
  ptSessionSupportingInstructors,
  workshops,
  workshopInstructors,
} from '../../db/schema/schedule'
import { instructors } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { BadRequestError, NotFoundError } from '../../shared/errors'
import { mergeRoster, type RosterEntry, type RosterPatch } from './roster-merge'

export type { RosterAssignment, RosterEntry, RosterPatch, RosterRole } from './roster-merge'

/** The handle `db.transaction(async tx => …)` hands its callback. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type RosterEventKind = 'class' | 'workshop' | 'pt_session' | 'corporate_session'

/** Which event a roster belongs to. */
export interface RosterRef {
  kind: RosterEventKind
  id: string
}

/** Error identity for "that event doesn't exist", one per kind. */
const notFoundCode: Record<RosterEventKind, string> = {
  class: 'class_not_found',
  workshop: 'workshop_not_found',
  pt_session: 'pt_session_not_found',
  corporate_session: 'corporate_session_not_found',
}

/** A transaction handle is the same object at runtime; drizzle just types the
 *  two differently. Same cast the class module used before this existed. */
export const exec = (tx?: Tx): typeof db => (tx ? (tx as unknown as typeof db) : db)

/** SGD number → the `numeric(10,2)` text postgres wants. */
const money = (paySgd: number | null): string | null => (paySgd == null ? null : paySgd.toFixed(2))

/** …and back. */
const sgd = (paySgd: string | null): number | null => (paySgd == null ? null : Number(paySgd))

/**
 * Assert every id belongs to an active instructor, and heal a missing
 * `instructors` profile row (orphans exist from before the invite flow created
 * them — see 0008_backfill_instructor_profiles.sql).
 *
 * Exported because an event row's own main-instructor FK points at
 * `instructors.staff_user_id`, so a create has to satisfy it before there is an
 * event to hang a roster on.
 */
export async function ensureInstructors(instructorIds: string[], tx?: Tx): Promise<void> {
  if (instructorIds.length === 0) return
  const unique = Array.from(new Set(instructorIds))
  const valid = await exec(tx)
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(
      and(
        inArray(staffUsers.id, unique),
        eq(staffUsers.role, 'instructor'),
        isNull(staffUsers.deletedAt),
      ),
    )
  if (valid.length !== unique.length) throw new BadRequestError('invalid_instructor_id')
  await exec(tx)
    .insert(instructors)
    .values(unique.map(staffUserId => ({ staffUserId })))
    .onConflictDoNothing({ target: instructors.staffUserId })
}

/**
 * Rosters for many events at once, keyed by event id. Events that don't exist
 * are absent from the map (rather than mapping to an empty roster, which is a
 * real state for the kinds where every assignment is a row).
 */
export async function readRosters(
  kind: RosterEventKind,
  eventIds: string[],
  tx?: Tx,
): Promise<Map<string, RosterEntry[]>> {
  const out = new Map<string, RosterEntry[]>()
  if (eventIds.length === 0) return out

  if (kind === 'workshop') {
    // Every assignment is a row here, main included — so existence comes from
    // the workshop itself, not from having any roster rows.
    const events = await exec(tx)
      .select({ id: workshops.id })
      .from(workshops)
      .where(inArray(workshops.id, eventIds))
    for (const e of events) out.set(e.id, [])

    const assigned = await exec(tx)
      .select({
        workshopId: workshopInstructors.workshopId,
        instructorId: workshopInstructors.instructorId,
        role: workshopInstructors.role,
        paySgd: workshopInstructors.paySgd,
      })
      .from(workshopInstructors)
      .where(inArray(workshopInstructors.workshopId, eventIds))
    for (const a of assigned) {
      out.get(a.workshopId)?.push({
        instructorId: a.instructorId,
        role: a.role,
        paySgd: sgd(a.paySgd),
      })
    }
  } else {
    // The other three keep the main instructor on the event row and everyone
    // else in a side table — only the column names differ. Corporate sessions
    // have no pay columns anywhere, so their roster reads back unpriced.
    const mains =
      kind === 'class'
        ? (
            await exec(tx)
              .select({
                id: classes.id,
                instructorId: classes.mainInstructorId,
                paySgd: classes.instructorPaySgd,
              })
              .from(classes)
              .where(inArray(classes.id, eventIds))
          ).map(e => ({ id: e.id, instructorId: e.instructorId, paySgd: sgd(e.paySgd) }))
        : kind === 'pt_session'
          ? (
              await exec(tx)
                .select({
                  id: ptSessions.id,
                  instructorId: ptSessions.instructorId,
                  paySgd: ptSessions.instructorPaySgd,
                })
                .from(ptSessions)
                .where(inArray(ptSessions.id, eventIds))
            ).map(e => ({ id: e.id, instructorId: e.instructorId, paySgd: sgd(e.paySgd) }))
          : (
              await exec(tx)
                .select({ id: corporateSessions.id, instructorId: corporateSessions.mainInstructorId })
                .from(corporateSessions)
                .where(inArray(corporateSessions.id, eventIds))
            ).map(e => ({ id: e.id, instructorId: e.instructorId, paySgd: null }))
    for (const m of mains) {
      out.set(m.id, [{ instructorId: m.instructorId, role: 'main', paySgd: m.paySgd }])
    }

    const supporting =
      kind === 'class'
        ? (
            await exec(tx)
              .select({
                eventId: classSupportingInstructors.classId,
                instructorId: classSupportingInstructors.instructorId,
                paySgd: classSupportingInstructors.paySgd,
              })
              .from(classSupportingInstructors)
              .where(inArray(classSupportingInstructors.classId, eventIds))
          ).map(s => ({ eventId: s.eventId, instructorId: s.instructorId, paySgd: sgd(s.paySgd) }))
        : kind === 'pt_session'
          ? (
              await exec(tx)
                .select({
                  eventId: ptSessionSupportingInstructors.ptSessionId,
                  instructorId: ptSessionSupportingInstructors.instructorId,
                  paySgd: ptSessionSupportingInstructors.paySgd,
                })
                .from(ptSessionSupportingInstructors)
                .where(inArray(ptSessionSupportingInstructors.ptSessionId, eventIds))
            ).map(s => ({ eventId: s.eventId, instructorId: s.instructorId, paySgd: sgd(s.paySgd) }))
          : (
              await exec(tx)
                .select({
                  eventId: corporateSessionSupportingInstructors.corporateSessionId,
                  instructorId: corporateSessionSupportingInstructors.instructorId,
                })
                .from(corporateSessionSupportingInstructors)
                .where(inArray(corporateSessionSupportingInstructors.corporateSessionId, eventIds))
            ).map(s => ({ eventId: s.eventId, instructorId: s.instructorId, paySgd: null }))
    for (const s of supporting) {
      out.get(s.eventId)?.push({
        instructorId: s.instructorId,
        role: 'supporting',
        paySgd: s.paySgd,
      })
    }
  }

  for (const roster of out.values()) {
    roster.sort(
      (a, b) =>
        Number(a.role === 'supporting') - Number(b.role === 'supporting') ||
        a.instructorId.localeCompare(b.instructorId),
    )
  }
  return out
}

/** One event's roster — main first, then supporting by instructor id. Empty when
 *  the event doesn't exist; `replaceRoster` is where a missing event is an error. */
export async function readRoster(ref: RosterRef, tx?: Tx): Promise<RosterEntry[]> {
  return (await readRosters(ref.kind, [ref.id], tx)).get(ref.id) ?? []
}

/**
 * Apply `patch` to the event's roster and write the result. Returns the roster
 * as it now stands.
 *
 * The merge is the point: an instructor who stays keeps their recorded pay
 * unless the caller supplies a new value. Omitting `supporting` (and
 * `supportingInstructorIds`) leaves the supporting table untouched entirely;
 * omitting `main` leaves the main role holder and their pay alone.
 */
export async function replaceRoster(
  tx: Tx,
  ref: RosterRef,
  patch: RosterPatch,
): Promise<RosterEntry[]> {
  const existing = (await readRosters(ref.kind, [ref.id], tx)).get(ref.id)
  if (!existing) throw new NotFoundError(notFoundCode[ref.kind])

  const merged = mergeRoster(existing, patch)
  if (!merged.ok) throw new BadRequestError(merged.refusal)
  const roster = merged.roster

  // Only ids the CALLER named: an instructor already on the event has a valid FK
  // by construction, and re-validating them would make a pay-only edit fail on a
  // class whose instructor was archived after it was scheduled.
  await ensureInstructors(
    [
      ...(patch.main?.instructorId !== undefined ? [patch.main.instructorId] : []),
      ...(patch.supporting?.map(s => s.instructorId) ?? []),
      ...(patch.supportingInstructorIds ?? []),
    ],
    tx,
  )

  if (ref.kind === 'workshop') {
    // Main and supporting are rows in one table, so one rewrite covers both.
    // Safe wholesale: `roster` restates untouched members with their merged pay,
    // so the delete can't drop a price the caller didn't ask to change.
    await exec(tx).delete(workshopInstructors).where(eq(workshopInstructors.workshopId, ref.id))
    if (roster.length > 0) {
      await exec(tx)
        .insert(workshopInstructors)
        .values(
          roster.map(r => ({
            workshopId: ref.id,
            instructorId: r.instructorId,
            role: r.role,
            paySgd: money(r.paySgd),
          })),
        )
    }
    return roster
  }

  if (patch.main !== undefined) {
    const main = roster.find(r => r.role === 'main')
    if (main) {
      const pay = money(main.paySgd)
      if (ref.kind === 'class') {
        await exec(tx)
          .update(classes)
          .set({ mainInstructorId: main.instructorId, instructorPaySgd: pay })
          .where(eq(classes.id, ref.id))
      } else if (ref.kind === 'pt_session') {
        await exec(tx)
          .update(ptSessions)
          .set({ instructorId: main.instructorId, instructorPaySgd: pay })
          .where(eq(ptSessions.id, ref.id))
      } else {
        // No pay column on a corporate session — who runs it is all there is.
        await exec(tx)
          .update(corporateSessions)
          .set({ mainInstructorId: main.instructorId })
          .where(eq(corporateSessions.id, ref.id))
      }
    }
  }

  if (patch.supporting !== undefined || patch.supportingInstructorIds !== undefined) {
    // Safe to rewrite wholesale now: the rows being re-inserted already carry
    // the merged pay, so nothing is lost by the delete.
    const supporting = roster.filter(r => r.role === 'supporting')
    if (ref.kind === 'class') {
      await exec(tx)
        .delete(classSupportingInstructors)
        .where(eq(classSupportingInstructors.classId, ref.id))
      if (supporting.length > 0) {
        await exec(tx)
          .insert(classSupportingInstructors)
          .values(
            supporting.map(s => ({
              classId: ref.id,
              instructorId: s.instructorId,
              paySgd: money(s.paySgd),
            })),
          )
      }
    } else if (ref.kind === 'pt_session') {
      await exec(tx)
        .delete(ptSessionSupportingInstructors)
        .where(eq(ptSessionSupportingInstructors.ptSessionId, ref.id))
      if (supporting.length > 0) {
        await exec(tx)
          .insert(ptSessionSupportingInstructors)
          .values(
            supporting.map(s => ({
              ptSessionId: ref.id,
              instructorId: s.instructorId,
              paySgd: money(s.paySgd),
            })),
          )
      }
    } else {
      await exec(tx)
        .delete(corporateSessionSupportingInstructors)
        .where(eq(corporateSessionSupportingInstructors.corporateSessionId, ref.id))
      if (supporting.length > 0) {
        await exec(tx)
          .insert(corporateSessionSupportingInstructors)
          .values(
            supporting.map(s => ({
              corporateSessionId: ref.id,
              instructorId: s.instructorId,
            })),
          )
      }
    }
  }

  return roster
}

/**
 * Price one instructor on one event (`null` clears it). Returns false when the
 * event doesn't exist or that instructor isn't on its roster — the caller
 * decides whether that's a 404 or a no-op.
 *
 * This is the write the Payroll screen makes; it does not disturb anyone else's
 * pay, so it needs no merge.
 */
export async function setInstructorPay(
  ref: RosterRef,
  instructorId: string,
  paySgd: number | null,
  tx?: Tx,
): Promise<boolean> {
  if (ref.kind === 'workshop') {
    // Role doesn't matter: main and supporting are the same row shape here.
    const rows = await exec(tx)
      .update(workshopInstructors)
      .set({ paySgd: money(paySgd) })
      .where(
        and(
          eq(workshopInstructors.workshopId, ref.id),
          eq(workshopInstructors.instructorId, instructorId),
        ),
      )
      .returning({ workshopId: workshopInstructors.workshopId })
    return rows.length > 0
  }

  // A corporate session has no pay column on either table — nobody on one can
  // be priced, so there is nothing to write. Payroll doesn't list them.
  if (ref.kind === 'corporate_session') return false

  const [event] =
    ref.kind === 'class'
      ? await exec(tx)
          .select({ mainInstructorId: classes.mainInstructorId })
          .from(classes)
          .where(eq(classes.id, ref.id))
          .limit(1)
      : await exec(tx)
          .select({ mainInstructorId: ptSessions.instructorId })
          .from(ptSessions)
          .where(eq(ptSessions.id, ref.id))
          .limit(1)
  if (!event) return false

  if (event.mainInstructorId === instructorId) {
    const rows =
      ref.kind === 'class'
        ? await exec(tx)
            .update(classes)
            .set({ instructorPaySgd: money(paySgd) })
            .where(eq(classes.id, ref.id))
            .returning({ id: classes.id })
        : await exec(tx)
            .update(ptSessions)
            .set({ instructorPaySgd: money(paySgd) })
            .where(eq(ptSessions.id, ref.id))
            .returning({ id: ptSessions.id })
    return rows.length > 0
  }

  const rows =
    ref.kind === 'class'
      ? await exec(tx)
          .update(classSupportingInstructors)
          .set({ paySgd: money(paySgd) })
          .where(
            and(
              eq(classSupportingInstructors.classId, ref.id),
              eq(classSupportingInstructors.instructorId, instructorId),
            ),
          )
          .returning({ id: classSupportingInstructors.classId })
      : await exec(tx)
          .update(ptSessionSupportingInstructors)
          .set({ paySgd: money(paySgd) })
          .where(
            and(
              eq(ptSessionSupportingInstructors.ptSessionId, ref.id),
              eq(ptSessionSupportingInstructors.instructorId, instructorId),
            ),
          )
          .returning({ id: ptSessionSupportingInstructors.ptSessionId })
  return rows.length > 0
}
