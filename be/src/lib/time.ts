/**
 * Singapore time — the studio's only clock.
 *
 * Everything is stored UTC; every date a human reads is `Asia/Singapore`, which
 * is UTC+8 with no DST and has never been anything else. That is why the
 * arithmetic below is a fixed offset rather than a timezone database lookup, and
 * why the same fixed offset is safe for every year this system will see.
 *
 * Imports nothing on purpose: a rule module can depend on this without gaining a
 * database, an env or a clock.
 */

/** A calendar day in Singapore, `YYYY-MM-DD`. Not an instant. */
export type PlainDate = string

const SG_TIME_ZONE = 'Asia/Singapore'

const SG_OFFSET_MS = 8 * 3_600_000
const MS_PER_DAY = 86_400_000

const asUtcMidnight = (d: PlainDate) => Date.parse(`${d}T00:00:00Z`)

/** Today in Singapore, from any instant. */
export function sgToday(now: Date): PlainDate {
  return new Date(now.getTime() + SG_OFFSET_MS).toISOString().slice(0, 10)
}

/** Whole days between two plain dates; negative if `b` is before `a`. */
export function daysBetween(a: PlainDate, b: PlainDate): number {
  return Math.round((asUtcMidnight(b) - asUtcMidnight(a)) / MS_PER_DAY)
}

/**
 * A run of Singapore calendar days as a half-open instant window: the start of
 * `startDate` up to the start of the day AFTER `endDate`, so it never bleeds
 * into the adjacent day. `endDate` defaults to a single day.
 */
export function sgDayWindow(
  startDate: PlainDate,
  endDate: PlainDate = startDate,
): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: new Date(asUtcMidnight(startDate) - SG_OFFSET_MS),
    endsAt: new Date(asUtcMidnight(endDate) + MS_PER_DAY - SG_OFFSET_MS),
  }
}

/** An instant formatter fixed to studio time. The zone is what's shared; the
 *  locale and the format are the caller's, because they legitimately differ. */
export const sgFormat = (locale: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale, { timeZone: SG_TIME_ZONE, ...options })
