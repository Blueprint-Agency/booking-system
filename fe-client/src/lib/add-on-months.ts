import { plusCalendarMonths, wholeDaysBetween } from "./studio-time.ts";

/**
 * Whether the server rounded a part month up to a whole one — the only case the
 * part-months sentence exists to pre-empt (§494). Whole days is the granularity
 * the rule is about: two instants never agree to the millisecond, so testing the
 * charged months against the plan's end for exact equality read "part-used" for
 * every plan, including one bought seconds ago, and manufactured the surprise
 * the sentence is there to answer.
 *
 * Months and days are counted on the studio's calendar (its zone, never the
 * device's), so a plan across a daylight-saving change is not a day out.
 *
 * A commented mirror of `crossLocationMonths` in
 * `be/src/services/packages/validity.ts` — the server prices the charge; this
 * only decides whether the member is owed an explanation of it.
 */
export function roundsUpAPartMonth(
  expiresAt: string | number,
  months: number,
  timezone: string,
  now: number = Date.now(),
): boolean {
  return months >= 1 && wholeDaysBetween(timezone, expiresAt, plusCalendarMonths(timezone, now, months)) >= 1;
}
