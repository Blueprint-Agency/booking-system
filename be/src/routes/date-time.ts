import { z } from 'zod'

/**
 * A moment in time, as an ISO 8601 date and time with an explicit offset
 * (`2026-01-31T09:00:00Z`, `2026-01-31T09:00:00+08:00`): the form
 * `Date.prototype.toISOString()` gives, and the only one every caller sends.
 *
 * It must be on a day that exists (no 30 February, no month 13) and in a year
 * from 0001 to 9999, so it is a value Postgres takes and the JavaScript date
 * parser reads as written. That parser is not a check: `Date.parse` rolls
 * `2026-02-30` forward to 2 March, reads `20260-01-01` as year 20259, and
 * accepts `12/31/99999`; a route that used it saved a session on the wrong day
 * and answered success. A time with no offset, a bare date and the non-ISO
 * forms are refused rather than reinterpreted.
 *
 * Every field that holds a moment uses this one, so a new route gets the check
 * by default. Its sibling for a calendar day is `plainDate` (`./plain-date.ts`).
 *
 * `label` starts the refusal sentence ("A start time must be a date and time
 * like 2026-01-31T09:00:00Z."). `message` replaces that sentence, for the few
 * fields whose form already shows one of its own.
 */
export function dateTime(label: string, message = `${label} must be a date and time like 2026-01-31T09:00:00Z.`) {
  return z
    .string({ message })
    .datetime({ offset: true, message })
    .refine(v => Number(v.slice(0, 4)) >= 1, { message })
}
