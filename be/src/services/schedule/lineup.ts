/**
 * The combined instructor list — `[main, ...supporting]` — in one place.
 *
 * Every screen that names who is on an event returns this alongside the two
 * halves, and a dozen call sites used to spell the ternary out inline (each with
 * its own opinion about what an event with no main instructor should produce).
 * Who is actually on the event comes from `./roster.ts`; this is only the shape
 * the API has always returned.
 *
 * Free of runtime imports — the `RosterEntry` import is types-only — so it stays
 * checkable without a DB or a loaded env, same as `./roster-merge.ts`.
 */
import type { RosterEntry } from './roster-merge'

export interface Lineup {
  mainInstructorId: string | null
  supportingInstructorIds: string[]
  /** Back-compat — [main, ...supporting]. */
  instructorIds: string[]
}

/** `[main, ...supporting]`, or just the supporting ids when there is no main. */
export function combinedInstructorIds(
  mainInstructorId: string | null,
  supportingInstructorIds: string[],
): string[] {
  return mainInstructorId
    ? [mainInstructorId, ...supportingInstructorIds]
    : [...supportingInstructorIds]
}

/** `lineupOf` over a batch — pairs with `readRosters`. */
export function lineupsOf(rosters: Map<string, RosterEntry[]>): Map<string, Lineup> {
  return new Map([...rosters].map(([id, roster]) => [id, lineupOf(roster)]))
}

/**
 * Split a roster into the three id shapes the API returns. Ordering is the
 * roster's own (main first, then supporting by instructor id) — this does not
 * re-sort, and pay is dropped: callers that need it read the roster directly.
 */
export function lineupOf(roster: RosterEntry[]): Lineup {
  const mainInstructorId = roster.find(r => r.role === 'main')?.instructorId ?? null
  const supportingInstructorIds = roster
    .filter(r => r.role === 'supporting')
    .map(r => r.instructorId)
  return {
    mainInstructorId,
    supportingInstructorIds,
    instructorIds: combinedInstructorIds(mainInstructorId, supportingInstructorIds),
  }
}
