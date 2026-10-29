import { z } from 'zod'
import { isIsoDate } from '../services/tenants/term-dates'

/**
 * A moment in time, as an ISO 8601 date and time with an explicit offset
 * (`2026-01-31T09:00:00Z`, `2026-01-31T09:00:00+08:00`): the form
 * `Date.prototype.toISOString()` gives, and the one every app sends. A bare
 * calendar date (`2026-01-31`) is also taken, as midnight UTC at the start of
 * that day, as `Date.parse` has always read it, so a script that filters by day
 * keeps working.
 *
 * It must be on a day that exists (no 30 February, no month 13), at an offset
 * the clock has, and in a year from 0001 to 9999 once that offset is applied
 * (an Invalid Date has a NaN year, which fails the same test), so it is a value
 * Postgres takes and the JavaScript date parser reads as written. That parser
 * is not a check: `Date.parse` rolls `2026-02-30` forward to 2 March, reads
 * `20260-01-01` as year 20259, and accepts `12/31/99999`; a route that used it
 * saved a session on the wrong day and answered success. A bare date is
 * therefore tested as a real calendar day (`isIsoDate`) before it is taken. A
 * time with no offset and the non-ISO forms are refused rather than
 * reinterpreted.
 *
 * Every field that holds a moment uses this one, so a new route gets the check
 * by default. Its sibling for a calendar day is `plainDate` (`./plain-date.ts`).
 *
 * `label` starts the refusal sentence ("A start time must be a date and time
 * like 2026-01-31T09:00:00Z, or a date like 2026-01-31."). `message` replaces
 * that sentence, for the few fields whose form already shows one of its own.
 */
export function dateTime(
  label: string,
  message = `${label} must be a date and time like 2026-01-31T09:00:00Z, or a date like 2026-01-31.`,
) {
  return z.string({ message }).refine(isMoment, { message })
}

const withOffset = z.string().datetime({ offset: true })

function isMoment(v: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return isIsoDate(v)
  return withOffset.safeParse(v).success && isUsableInstant(v)
}

/**
 * The text names an instant the JavaScript date reads, and that instant falls in
 * the years 1 to 9999 in UTC. Both are tested on the parsed value, not the
 * text: `+24:00`, `+99:99` and `-25:00` are offsets the pattern takes and
 * `new Date` turns into Invalid Date, and `9999-12-31T23:00:00-08:00` and
 * `0001-01-01T00:00:00+08:00` have a year in range as written and one that
 * Postgres refuses once the offset is applied.
 */
function isUsableInstant(v: string): boolean {
  const year = new Date(v).getUTCFullYear()
  return year >= 1 && year <= 9999
}
