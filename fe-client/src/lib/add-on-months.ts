const DAY_MS = 86_400_000;

/**
 * Calendar months added to an instant, the way the server adds them
 * (`addMonths` in `be/src/services/packages/validity.ts`): UTC throughout, the
 * day of the month clamped to the target month's last, so 31 August plus six
 * months is 28 February.
 *
 * Deliberately not the studio's calendar. A package's end is stamped by that
 * UTC arithmetic, and this mirror must land on the same instants it does; a
 * studio east of UTC reads the same plan a day off otherwise (a plan activated
 * at 01:00 on 1 March in Sydney is 28 February in UTC).
 */
export function addMonthsUtc(from: number, months: number): number {
  const d = new Date(from);
  const day = d.getUTCDate();
  // Park on the 1st first so the month shift can't overflow on its own.
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return d.getTime();
}

/** Whole 24-hour days from `from` to `to`, truncated toward zero. */
export function wholeDaysUtc(from: number, to: number): number {
  return Math.trunc((to - from) / DAY_MS);
}

/**
 * Whether the server rounded a part month up to a whole one — the only case the
 * part-months sentence exists to pre-empt (§494). Whole days is the granularity
 * the rule is about: two instants never agree to the millisecond, so testing the
 * charged months against the plan's end for exact equality read "part-used" for
 * every plan, including one bought seconds ago, and manufactured the surprise
 * the sentence is there to answer.
 *
 * A commented mirror of `crossLocationMonths` in
 * `be/src/services/packages/validity.ts` — the server prices the charge; this
 * only decides whether the member is owed an explanation of it. It counts as
 * the server does (UTC months, 24-hour days), not on the studio's clock.
 */
export function roundsUpAPartMonth(expiresAt: string | number, months: number, now: number = Date.now()): boolean {
  const end = typeof expiresAt === "number" ? expiresAt : Date.parse(expiresAt);
  return months >= 1 && wholeDaysUtc(end, addMonthsUtc(now, months)) >= 1;
}
