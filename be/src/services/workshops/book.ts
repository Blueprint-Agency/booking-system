import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import {
  workshops,
  workshopTiers,
  workshopTierDays,
  workshopDays,
} from '../../db/schema/schedule'
import { stripePayments } from '../../db/schema/ledger'
import { isUniqueViolation } from '../../db/unique-violation'
import { generateBookingCodes } from '../bookings/qr'
import { bestPrice, listActivePromotionsFor } from '../packages/promotions'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { sendWorkshopPurchaseEmail } from '../notifications/send-purchase-email'

type WorkshopTierRow = typeof workshopTiers.$inferSelect

/**
 * Effective base price for a tier in SGD ("120.00"), mirroring fe-client's
 * `tierEffectivePrice()`: an early-bird price takes precedence over promotions
 * while the cutoff is in the future; otherwise best-price-wins applies against
 * the regular price. Returns the frozen promotion id only when a promotion
 * (not early-bird) set the price.
 */
export function tierEffectivePrice(
  tier: WorkshopTierRow,
  promos: Parameters<typeof bestPrice>[1],
  now = new Date(),
): { baseSgd: string; appliedPromotionId: string | null } {
  const earlyBirdActive =
    tier.earlyBirdPriceSgd != null && tier.earlyBirdCutoffAt != null && tier.earlyBirdCutoffAt > now
  if (earlyBirdActive) {
    return { baseSgd: tier.earlyBirdPriceSgd!, appliedPromotionId: null }
  }
  const eff = bestPrice(tier.regularPriceSgd, promos)
  return { baseSgd: eff.effectivePriceSgd, appliedPromotionId: eff.appliedPromotionId }
}

/**
 * Pre-purchase gate for workshop bookings, run BEFORE creating a Stripe
 * Checkout session (no automated refund flow exists yet, so charging for an
 * unbookable spot must be prevented up front):
 *
 *   409 already_booked — the client already holds a confirmed booking for this workshop
 *   409 workshop_full  — any day covered by the tier has no online capacity left
 *
 * Capacity = per-day `capacity_online` vs confirmed bookings across ALL tiers
 * covering that day. Best-effort (no row lock) — acceptable for v1 volumes.
 */
export async function assertWorkshopBookable(
  tenantId: string,
  args: {
    clientId: string
    workshopId: string
    workshopTierId: string
  },
): Promise<void> {
  const [dup] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.clientId, args.clientId),
        eq(bookings.workshopId, args.workshopId),
        eq(bookings.kind, 'workshop'),
        eq(bookings.state, 'confirmed'),
      ),
    )
    .limit(1)
  if (dup) throw new ConflictError('already_booked')

  const tierDayRows = await db
    .select({ dayId: workshopTierDays.workshopDayId, cap: workshopDays.capacityOnline })
    .from(workshopTierDays)
    .innerJoin(workshopDays, eq(workshopDays.id, workshopTierDays.workshopDayId))
    .where(
      and(
        eq(workshopTierDays.tenantId, tenantId),
        eq(workshopTierDays.workshopTierId, args.workshopTierId),
      ),
    )
  if (tierDayRows.length === 0) return

  // The count that decides "full" is the sharp one: unscoped it would add
  // another studio's seats to this studio's day and turn a workshop away that
  // has room.
  const dayIds = tierDayRows.map(r => r.dayId)
  const counts = await db
    .select({
      dayId: workshopTierDays.workshopDayId,
      cnt: sql<number>`count(*)::int`,
    })
    .from(bookings)
    .innerJoin(workshopTierDays, eq(workshopTierDays.workshopTierId, bookings.workshopTierId))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(workshopTierDays.tenantId, tenantId),
        eq(bookings.kind, 'workshop'),
        eq(bookings.state, 'confirmed'),
        inArray(workshopTierDays.workshopDayId, dayIds),
      ),
    )
    .groupBy(workshopTierDays.workshopDayId)
  const bookedByDay = new Map(counts.map(c => [c.dayId, Number(c.cnt)]))

  for (const d of tierDayRows) {
    if ((bookedByDay.get(d.dayId) ?? 0) >= d.cap) throw new ConflictError('workshop_full')
  }
}

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
  /** frozen Promo Code the member typed at purchase (§11); null if none. */
  appliedPromoCodeId?: string | null
}

/**
 * Insert a confirmed workshop booking. Used by:
 *  - billing webhook (Stripe-paid workshops) via bookWorkshopPaid
 *  - free workshop checkout (price 0) via bookWorkshopFree
 *
 * Idempotent on paymentIntentId via the partial unique index
 * `bookings_stripe_intent_unique`. Inserts/updates the matching
 * stripe_payments row so refunds can find it.
 *
 * `created` says whether THIS call inserted the booking (§13) — the flag the
 * confirmation email is gated on, so a redelivered webhook confirms once.
 */
async function insertWorkshopBooking(
  tenantId: string,
  input: BookWorkshopInput,
): Promise<{ bookingId: string; qrToken: string; code: string; created: boolean }> {
  const { qrToken, code } = generateBookingCodes()

  // Idempotency: if a booking already exists for this payment intent, return it.
  if (input.paymentIntentId) {
    const existing = await bookingForIntent(tenantId, input.paymentIntentId)
    if (existing) return { ...existing, created: false }
  }

  // Frozen workshop money (§15). List Price is the tier's regular price — the
  // headline figure an early-bird or a Promotion is cut from — read here so BOTH
  // the paid and the free path record it. A free workshop stores that price
  // against zero paid, same as a comp grant; a zero would hide the giveaway.
  // The money off is derived (list minus paid) and never stored.
  const [tierRow] = await db
    .select({ regularPriceSgd: workshopTiers.regularPriceSgd })
    .from(workshopTiers)
    .where(and(eq(workshopTiers.tenantId, tenantId), eq(workshopTiers.id, input.workshopTierId)))
    .limit(1)
  if (!tierRow) throw new NotFoundError('workshop_tier_not_found')

  try {
    const [row] = await db
      .insert(bookings)
      .values({
        tenantId,
        clientId: input.clientId,
        kind: 'workshop',
        workshopId: input.workshopId,
        workshopTierId: input.workshopTierId,
        appliedPromotionId: input.appliedPromotionId ?? null,
        appliedPromoCodeId: input.appliedPromoCodeId ?? null,
        listPriceSgd: tierRow.regularPriceSgd,
        amountPaidSgd: input.amountSgd,
        state: 'confirmed',
        qrToken,
        code,
        stripePaymentIntentId: input.paymentIntentId,
      })
      .returning({ id: bookings.id })

    const bookingId = row!.id

    // Only the delivery that inserted writes this, and it is the only writer of
    // `succeeded` for a workshop — the race loser below returns before it,
    // because the winner has already done it.
    if (input.paymentIntentId) {
      await db
        .update(stripePayments)
        .set({ status: 'succeeded', bookingId })
        .where(
          and(
            eq(stripePayments.tenantId, tenantId),
            eq(stripePayments.paymentIntentId, input.paymentIntentId),
          ),
        )
    }

    return { bookingId, qrToken, code, created: true }
  } catch (err: unknown) {
    // The idempotency read above lost a race — the webhook and the confirmation
    // page's sync-session both deliver one purchase. The index picks the winner;
    // the loser returns the winner's booking rather than failing the member.
    if (input.paymentIntentId && isUniqueViolation(err, 'bookings_stripe_intent_unique')) {
      const existing = await bookingForIntent(tenantId, input.paymentIntentId)
      if (existing) return { ...existing, created: false }
    }
    throw err
  }
}

/** The booking already made for a payment intent, if any (§13 idempotency). */
async function bookingForIntent(
  tenantId: string,
  paymentIntentId: string,
): Promise<{ bookingId: string; qrToken: string; code: string } | undefined> {
  const [row] = await db
    .select({ id: bookings.id, qrToken: bookings.qrToken, code: bookings.code })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.stripePaymentIntentId, paymentIntentId),
      ),
    )
    .limit(1)
  return row ? { bookingId: row.id, qrToken: row.qrToken, code: row.code } : undefined
}

export async function bookWorkshopPaid(
  tenantId: string,
  input: BookWorkshopInput & { paymentIntentId: string },
): Promise<{ bookingId: string; qrToken: string; code: string; created: boolean }> {
  return insertWorkshopBooking(tenantId, input)
}

export async function bookWorkshopFree(
  tenantId: string,
  args: {
    clientId: string
    workshopId: string
    workshopTierId: string
    /**
     * A Promo Code whose discount took the total to zero (§10). Such a purchase
     * skips the payment provider entirely and grants here, so the tier's own
     * price is allowed to be above zero when one is present.
     */
    appliedPromoCodeId?: string | null
  },
): Promise<{ bookingId: string; qrToken: string; code: string }> {
  const [tier] = await db
    .select()
    .from(workshopTiers)
    .where(
      and(
        eq(workshopTiers.tenantId, tenantId),
        eq(workshopTiers.id, args.workshopTierId),
        eq(workshopTiers.workshopId, args.workshopId),
      ),
    )
    .limit(1)
  if (!tier) throw new NotFoundError('workshop_tier_not_found')

  const [ws] = await db
    .select()
    .from(workshops)
    .where(and(eq(workshops.tenantId, tenantId), eq(workshops.id, args.workshopId)))
    .limit(1)
  if (!ws) throw new NotFoundError('workshop_not_found')
  if (ws.lifecycle !== 'active') throw new BadRequestError('workshop_not_active')

  const promos = await listActivePromotionsFor(tenantId, 'workshop', [args.workshopId])
  const eff = tierEffectivePrice(tier, promos[args.workshopId] ?? [])
  if (Number(eff.baseSgd) > 0 && !args.appliedPromoCodeId) {
    throw new BadRequestError('workshop_is_not_free')
  }

  // Free bookings carry no payment-intent idempotency key, so gate duplicates
  // (and capacity) explicitly.
  await assertWorkshopBookable(tenantId, args)

  const booked = await insertWorkshopBooking(tenantId, {
    clientId: args.clientId,
    workshopId: args.workshopId,
    workshopTierId: args.workshopTierId,
    paymentIntentId: null,
    amountSgd: '0.00',
    appliedPromotionId: eff.appliedPromotionId,
    appliedPromoCodeId: args.appliedPromoCodeId ?? null,
  })

  // The worst case in the set (§13): a confirmed booking with a QR code and a
  // date that used to send nothing at all. No payment intent means nothing to
  // be idempotent on — `assertWorkshopBookable` above is the duplicate gate —
  // so it sends every time it gets here. The helper cannot throw.
  await sendWorkshopPurchaseEmail(tenantId, booked.bookingId)
  return booked
}
