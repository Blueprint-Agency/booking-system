import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import { workshops, workshopTiers } from '../../db/schema/schedule'
import { stripePayments } from '../../db/schema/ledger'
import { generateBookingCodes } from '../bookings/qr'
import { bestPrice, listActivePromotionsFor } from '../packages/promotions'
import { BadRequestError, NotFoundError } from '../../shared/errors'

export interface BookWorkshopInput {
  clientId: string
  workshopId: string
  workshopTierId: string
  /** stripe payment intent id — null for free workshops. */
  paymentIntentId: string | null
  /** amount paid in SGD as "120.00". "0.00" for free workshops. */
  amountSgd: string
  /** frozen promotion applied at purchase; null if none. */
  appliedPromotionId?: string | null
}

/**
 * Insert a confirmed workshop booking. Used by:
 *  - billing webhook (Stripe-paid workshops) via bookWorkshopPaid
 *  - free workshop checkout (price 0) via bookWorkshopFree
 *
 * Idempotent on paymentIntentId via the partial unique index
 * `bookings_stripe_intent_unique`. Inserts/updates the matching
 * stripe_payments row so refunds can find it.
 */
async function insertWorkshopBooking(
  input: BookWorkshopInput,
): Promise<{ bookingId: string; qrToken: string; code: string }> {
  const { qrToken, code } = generateBookingCodes()

  // Idempotency: if a booking already exists for this payment intent, return it.
  if (input.paymentIntentId) {
    const [existing] = await db
      .select({ id: bookings.id, qrToken: bookings.qrToken, code: bookings.code })
      .from(bookings)
      .where(eq(bookings.stripePaymentIntentId, input.paymentIntentId))
      .limit(1)
    if (existing) return { bookingId: existing.id, qrToken: existing.qrToken, code: existing.code }
  }

  const [row] = await db
    .insert(bookings)
    .values({
      clientId: input.clientId,
      kind: 'workshop',
      workshopId: input.workshopId,
      workshopTierId: input.workshopTierId,
      appliedPromotionId: input.appliedPromotionId ?? null,
      state: 'confirmed',
      qrToken,
      code,
      stripePaymentIntentId: input.paymentIntentId,
    })
    .returning({ id: bookings.id })

  const bookingId = row!.id

  if (input.paymentIntentId) {
    await db
      .update(stripePayments)
      .set({ status: 'succeeded', bookingId })
      .where(eq(stripePayments.paymentIntentId, input.paymentIntentId))
  }

  return { bookingId, qrToken, code }
}

export async function bookWorkshopPaid(
  input: BookWorkshopInput & { paymentIntentId: string },
): Promise<{ bookingId: string; qrToken: string; code: string }> {
  return insertWorkshopBooking(input)
}

export async function bookWorkshopFree(args: {
  clientId: string
  workshopId: string
  workshopTierId: string
}): Promise<{ bookingId: string; qrToken: string; code: string }> {
  const [tier] = await db
    .select()
    .from(workshopTiers)
    .where(and(eq(workshopTiers.id, args.workshopTierId), eq(workshopTiers.workshopId, args.workshopId)))
    .limit(1)
  if (!tier) throw new NotFoundError('workshop_tier_not_found')

  const [ws] = await db.select().from(workshops).where(eq(workshops.id, args.workshopId)).limit(1)
  if (!ws) throw new NotFoundError('workshop_not_found')
  if (ws.lifecycle !== 'active') throw new BadRequestError('workshop_not_active')

  const promos = await listActivePromotionsFor('workshop', [args.workshopId])
  const eff = bestPrice(tier.regularPriceSgd, promos[args.workshopId] ?? [])
  if (Number(eff.effectivePriceSgd) > 0) {
    throw new BadRequestError('workshop_is_not_free')
  }

  return insertWorkshopBooking({
    clientId: args.clientId,
    workshopId: args.workshopId,
    workshopTierId: args.workshopTierId,
    paymentIntentId: null,
    amountSgd: '0.00',
    appliedPromotionId: eff.appliedPromotionId,
  })
}
