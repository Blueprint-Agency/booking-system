import { z } from 'zod'
import type { PromotionWriteInput } from '../../../services/packages/promotions'
import { MAX_VALIDITY_DAYS } from '../../../services/packages/validity'
import { BadRequestError } from '../../../shared/errors'
import { dateTime } from '../../../shared/date-time'

/**
 * The fields a class package and a PT package share, each with the sentence
 * `explainInvalid` hands an admin when it is refused.
 */

const PRICE_MESSAGE = 'A price must be a number of dollars, like 120.00.'

// SGD prices come in as either a string ("120.00") or a number (120).
// Normalise to a 2dp string for the numeric column.
export const priceField = z
  .union([z.string(), z.number()], { errorMap: () => ({ message: PRICE_MESSAGE }) })
  .transform(v => {
    const n = typeof v === 'string' ? Number(v) : v
    if (!Number.isFinite(n) || n < 0) throw new BadRequestError('invalid_price')
    return n.toFixed(2)
  })

export const nameField = z
  .string({ message: 'A name must be text.' })
  .trim()
  .min(1, 'A package needs a name.')
  .max(160, 'A name can be at most 160 characters.')

// Ten years is the most: past that the admin means "no expiry" and may not.
const VALIDITY_MESSAGE = `Validity must be a whole number of days from 1 to ${MAX_VALIDITY_DAYS}.`
export const validityDaysField = z
  .number({ message: VALIDITY_MESSAGE })
  .int(VALIDITY_MESSAGE)
  .min(1, VALIDITY_MESSAGE)
  .max(MAX_VALIDITY_DAYS, VALIDITY_MESSAGE)

const PROMOTION_DATE_MESSAGE = 'A promotion starts and ends on a date and time, like 2026-01-31T09:00:00+08:00.'
const promotionDate = dateTime('A promotion date', PROMOTION_DATE_MESSAGE)
const PERCENT_MESSAGE = 'A promotion takes 1 to 99 percent off.'

const PROMOTION_ORDER_MESSAGE = 'A promotion has to end after it starts.'

// Promotion wire shape — mirrors serializePromotion's snake_case output so write/read are symmetric.
export const promotionInputSchema = z
  .object({
    id: z.string().uuid().nullish(),
    label: z
      .string({ message: 'A promotion label must be text.' })
      .min(1, 'A promotion needs a label.')
      .max(160, 'A promotion label can be at most 160 characters.'),
    kind: z.enum(['percent', 'special_price'], { message: 'A promotion is a percent off or a special price.' }),
    percent_off: z.number({ message: PERCENT_MESSAGE }).int(PERCENT_MESSAGE).min(1, PERCENT_MESSAGE).max(99, PERCENT_MESSAGE).nullish(),
    special_price_sgd: priceField.nullish(),
    starts_at: promotionDate,
    ends_at: promotionDate,
  })
  // The database refuses an end that is not after the start; the form is told which end, in a sentence, instead.
  .refine(p => Date.parse(p.ends_at) > Date.parse(p.starts_at), { message: PROMOTION_ORDER_MESSAGE, path: ['ends_at'] })

export const promotionsField = z.array(promotionInputSchema, { message: 'Promotions are a list.' })

export function toPromotionWriteInput(p: z.infer<typeof promotionInputSchema>): PromotionWriteInput {
  return {
    id: p.id ?? null,
    label: p.label,
    kind: p.kind,
    percentOff: p.percent_off ?? null,
    specialPriceSgd: p.special_price_sgd ?? null,
    startsAt: new Date(p.starts_at),
    endsAt: new Date(p.ends_at),
  }
}
