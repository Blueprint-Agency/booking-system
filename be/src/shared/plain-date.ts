import { z } from 'zod'
import { isIsoDate } from '../services/tenants/term-dates'

/**
 * A calendar date as `YYYY-MM-DD` that exists (no 30 February, no month 13, no
 * day 00, no year 0000 to 0099), refused with a sentence naming the field
 * (`label`, as it starts a sentence: "A start date"), so a year typed with five
 * digits or a day that is not on the calendar reads back as words
 * `explainInvalid` can show. Its sibling for a moment in time is `dateTime`
 * (`./date-time.ts`).
 */
export function plainDate(label: string) {
  const message = `${label} must be a date like 2026-01-31.`
  return z.string({ message }).refine(isIsoDate, message)
}
