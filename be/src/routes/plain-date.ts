import { z } from 'zod'

/**
 * A calendar date as `YYYY-MM-DD`, refused with a sentence naming the field
 * (`label`, as it starts a sentence: "A start date"), so a year typed with five
 * digits reads back as words `explainInvalid` can show.
 */
export function plainDate(label: string) {
  const message = `${label} must be a date like 2026-01-31.`
  return z.string({ message }).regex(/^\d{4}-\d{2}-\d{2}$/, message)
}
