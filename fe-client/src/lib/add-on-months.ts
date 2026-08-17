import { addMonths, differenceInDays } from "date-fns";

/**
 * Whether the server rounded a part month up to a whole one — the only case the
 * part-months sentence exists to pre-empt (§494). Whole days is the granularity
 * the rule is about: two `Date`s never agree to the millisecond, so testing the
 * charged months against the plan's end for exact equality read "part-used" for
 * every plan, including one bought seconds ago, and manufactured the surprise
 * the sentence is there to answer.
 *
 * A commented mirror of `crossLocationMonths` in
 * `be/src/services/packages/validity.ts` — the server prices the charge; this
 * only decides whether the member is owed an explanation of it.
 */
export function roundsUpAPartMonth(
  expiresAt: string | Date,
  months: number,
  now: Date = new Date(),
): boolean {
  return months >= 1 && differenceInDays(addMonths(now, months), new Date(expiresAt)) >= 1;
}
