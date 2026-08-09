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
 *     Callers see one shape — a list of `RosterEntry`.
 *   - Deduplication and the main-cannot-also-be-supporting rule are enforced in
 *     the merge, not by callers.
 *
 * Migrated so far: classes. Workshops, PT sessions and corporate sessions join
 * by widening `RosterEventKind` and adding their table wiring below — the
 * exported functions do not change shape.
 *
 * Still writes these columns outside this module, deliberately:
 *   - `payroll/list.ts` — `updatePayrollAmount`. Its per-instructor write is
 *     exactly `setInstructorPay`; it adopts this module with the payroll work.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { classes, classSupportingInstructors } from '../../db/schema/schedule'
import { instructors } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { BadRequestError, NotFoundError } from '../../shared/errors'
import { mergeRoster, type RosterEntry, type RosterPatch } from './roster-merge'

export type { RosterAssignment, RosterEntry, RosterPatch, RosterRole } from './roster-merge'

/** The handle `db.transaction(async tx => …)` hands its callback. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Widens to `| 'workshop' | 'pt_session' | 'corporate_session'` as those kinds migrate. */
export type RosterEventKind = 'class'

/** Which event a roster belongs to. */
export interface RosterRef {
  kind: RosterEventKind
  id: string
}

/** Error identity for "that event doesn't exist", one per kind. */
const notFoundCode: Record<RosterEventKind, string> = { class: 'class_not_found' }

/** A transaction handle is the same object at runtime; drizzle just types the
 *  two differently. Same cast the class module used before this existed. */
const exec = (tx?: Tx): typeof db => (tx ? (tx as unknown as typeof db) : db)

/** SGD number → the `numeric(10,2)` text postgres wants. */
const money = (paySgd: number | null): string | null => (paySgd == null ? null : paySgd.toFixed(2))

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
  void kind // one kind so far; the switch lands with the second.

  const events = await exec(tx)
    .select({
      id: classes.id,
      mainInstructorId: classes.mainInstructorId,
      paySgd: classes.instructorPaySgd,
    })
    .from(classes)
    .where(inArray(classes.id, eventIds))
  for (const e of events) {
    out.set(e.id, [
      {
        instructorId: e.mainInstructorId,
        role: 'main',
        paySgd: e.paySgd == null ? null : Number(e.paySgd),
      },
    ])
  }

  const supporting = await exec(tx)
    .select({
      classId: classSupportingInstructors.classId,
      instructorId: classSupportingInstructors.instructorId,
      paySgd: classSupportingInstructors.paySgd,
    })
    .from(classSupportingInstructors)
    .where(inArray(classSupportingInstructors.classId, eventIds))
  for (const s of supporting) {
    out.get(s.classId)?.push({
      instructorId: s.instructorId,
      role: 'supporting',
      paySgd: s.paySgd == null ? null : Number(s.paySgd),
    })
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

  if (patch.main !== undefined) {
    const main = roster.find(r => r.role === 'main')
    if (main) {
      await exec(tx)
        .update(classes)
        .set({ mainInstructorId: main.instructorId, instructorPaySgd: money(main.paySgd) })
        .where(eq(classes.id, ref.id))
    }
  }

  if (patch.supporting !== undefined || patch.supportingInstructorIds !== undefined) {
    // Safe to rewrite wholesale now: the rows being re-inserted already carry
    // the merged pay, so nothing is lost by the delete.
    await exec(tx)
      .delete(classSupportingInstructors)
      .where(eq(classSupportingInstructors.classId, ref.id))
    const supporting = roster.filter(r => r.role === 'supporting')
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
  const [event] = await exec(tx)
    .select({ mainInstructorId: classes.mainInstructorId })
    .from(classes)
    .where(eq(classes.id, ref.id))
    .limit(1)
  if (!event) return false

  if (event.mainInstructorId === instructorId) {
    const rows = await exec(tx)
      .update(classes)
      .set({ instructorPaySgd: money(paySgd) })
      .where(eq(classes.id, ref.id))
      .returning({ id: classes.id })
    return rows.length > 0
  }

  const rows = await exec(tx)
    .update(classSupportingInstructors)
    .set({ paySgd: money(paySgd) })
    .where(
      and(
        eq(classSupportingInstructors.classId, ref.id),
        eq(classSupportingInstructors.instructorId, instructorId),
      ),
    )
    .returning({ classId: classSupportingInstructors.classId })
  return rows.length > 0
}
