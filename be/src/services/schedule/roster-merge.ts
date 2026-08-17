/**
 * The roster merge rule, as a pure function — `./roster.ts` is the only thing
 * that writes the result to the DB.
 *
 * THE RULE: replacing a roster MERGES against the roster that is already there.
 * An instructor who is on the event before and after keeps the pay recorded
 * against them unless the caller supplies a new value. Pay is only lost when
 * the instructor leaves the roster (their entry simply isn't in the result), or
 * when the caller explicitly supplies `null` (= unpriced).
 *
 * Why it exists: the Payroll screen is where a supporting instructor's pay is
 * priced, and the Schedule screen used to rewrite the whole assignment table
 * with `paySgd: null` on every roster edit — silently wiping it. The merge is
 * the fix, and it lives here so the four scheduling modules can't each get it
 * slightly wrong.
 *
 * Kept free of imports so it stays checkable without a DB or a loaded env
 * (see roster-merge.test.ts). Refusals are returned rather than thrown for the
 * same reason; `roster.ts` maps them to the project's typed errors.
 */

export type RosterRole = 'main' | 'supporting'

/** One instructor's place on one event. `paySgd` null = not priced yet. */
export interface RosterEntry {
  instructorId: string
  role: RosterRole
  paySgd: number | null
}

/** One instructor as the CALLER supplies them. */
export interface RosterAssignment {
  instructorId: string
  /**
   * Omitted/`undefined` = leave pay alone (the merge keeps whatever is recorded).
   * `null` = explicitly unpriced. A number sets it.
   */
  paySgd?: number | null
}

/** The main-role holder as the caller supplies them. Both halves are optional:
 *  a caller may move the role to another instructor, re-price the current
 *  holder, or both. */
export interface MainAssignment {
  /** Omitted = whoever holds the main role today keeps it. */
  instructorId?: string
  /** Same three-way meaning as `RosterAssignment.paySgd`. */
  paySgd?: number | null
}

export interface RosterPatch {
  /** Omitted = the main role holder and their pay are left as they are. */
  main?: MainAssignment
  /** Omitted = the supporting roster is left exactly as it is, pay included. */
  supporting?: RosterAssignment[]
  /**
   * The older request shape that carries only instructor ids. It means "these
   * are the supporting instructors, leave their pay alone" — NOT "pay is
   * nothing". That is a deliberate behaviour change, and this is the ONE place
   * it is expressed; routes pass the id list straight through.
   *
   * Ignored when `supporting` is also supplied (the richer shape wins).
   */
  supportingInstructorIds?: string[]
}

export type RosterRefusal = 'supporting_instructor_duplicates_main'

/**
 * Who on this merged roster has newly arrived with no pay on them.
 *
 * Instructor Pay is required the moment someone joins a roster — at scheduling,
 * or on a later supporting add — because Net on the Finance page is only as
 * true as the pay behind it (be/docs/adr/0002-finance-replaces-payroll.md).
 *
 * Reported here rather than refused here, because whether it MATTERS depends on
 * the event kind, which this pure merge deliberately doesn't know: a corporate
 * session has no pay column on either of its tables, so every entry on one is
 * unpriced by construction and nothing is owed. `replaceRoster` knows the kind
 * and makes the call.
 *
 * It names ONLY instructors newly joining. Someone already on the event keeps
 * whatever is recorded for them, Unpriced included, so a roster edit on a
 * session scheduled before this rule still saves — those get cleared through
 * Finance's "Needs pay" filter, never by inventing a figure here.
 */
export function unpricedArrivals(
  existing: RosterEntry[],
  roster: RosterEntry[],
): RosterEntry[] {
  const already = new Set(existing.map(e => e.instructorId))
  return roster.filter(r => r.paySgd == null && !already.has(r.instructorId))
}

export type RosterMergeResult =
  | { ok: true; roster: RosterEntry[] }
  | { ok: false; refusal: RosterRefusal }

/**
 * Merge `patch` onto `existing` and return the roster the event should end up
 * with: the main entry first (when the event has one), then supporting entries
 * ordered by instructor id.
 *
 * Deduplication, the main-cannot-also-be-supporting rule and pay carry-over all
 * happen here. Note that carry-over is per INSTRUCTOR, not per role: an
 * instructor promoted from supporting to main brings their recorded pay with
 * them, and a departing main's pay does not stick to their replacement.
 */
export function mergeRoster(existing: RosterEntry[], patch: RosterPatch): RosterMergeResult {
  const recorded = new Map(existing.map(e => [e.instructorId, e.paySgd]))
  /** Supplied value wins; otherwise the instructor keeps what is recorded for them. */
  const payFor = (instructorId: string, supplied: number | null | undefined): number | null =>
    supplied !== undefined ? supplied : (recorded.get(instructorId) ?? null)

  const mainId = patch.main?.instructorId ?? existing.find(e => e.role === 'main')?.instructorId

  // Untouched supporting roster → re-state today's members with pay omitted, so
  // they fall through to carry-over like anyone else.
  const supplied: RosterAssignment[] =
    patch.supporting ??
    patch.supportingInstructorIds?.map(instructorId => ({ instructorId })) ??
    existing.filter(e => e.role === 'supporting').map(e => ({ instructorId: e.instructorId }))

  // Collapse duplicates: the last SUPPLIED pay wins, and a later bare repeat of
  // the same instructor doesn't erase a value given earlier in the same list.
  const bySupporting = new Map<string, number | null | undefined>()
  for (const s of supplied) {
    bySupporting.set(
      s.instructorId,
      s.paySgd !== undefined ? s.paySgd : bySupporting.get(s.instructorId),
    )
  }

  if (mainId !== undefined && bySupporting.has(mainId)) {
    return { ok: false, refusal: 'supporting_instructor_duplicates_main' }
  }

  const roster: RosterEntry[] = []
  if (mainId !== undefined) {
    roster.push({ instructorId: mainId, role: 'main', paySgd: payFor(mainId, patch.main?.paySgd) })
  }
  for (const [instructorId, paySgd] of [...bySupporting].sort(([a], [b]) => a.localeCompare(b))) {
    roster.push({ instructorId, role: 'supporting', paySgd: payFor(instructorId, paySgd) })
  }

  return { ok: true, roster }
}
