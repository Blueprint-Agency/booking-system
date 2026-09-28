/**
 * What a workshop booking costs and what happens next (§10, §11) — the workshop
 * half of `services/packages/checkout.ts`, and the same rule: a purchase with
 * nothing left to charge skips the payment provider and books immediately.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { workshops, workshopTiers } from '../../db/schema/schedule'
import { clashError } from '../bookings/member-time'
import { NotFoundError } from '../../shared/errors'
import { toCents } from '../../shared/money'
import {
  grantsWithoutPaying,
  saleDescription,
  type CheckoutQuote,
} from '../billing/checkout-session'
import { openSettledPurchase } from '../billing/purchases'
import { tenantDisplayName } from '../tenants/mail-identity'
import { listActivePromotionsFor } from '../packages/promotions'
import { applyPromoCode, type AppliedPromoCode } from '../packages/promo-redemption'
import { assertWorkshopBookable, assertWorkshopOnSale, bookWorkshopFree, tierDaysClash, tierEffectivePrice } from './book'

export type WorkshopCheckout = CheckoutQuote<{ bookingId: string }>

/**
 * 409 `time_clash` when any day of the tier overlaps a booking the member
 * holds. Asked at checkout start, without a lock, as the workshop's capacity is:
 * a class booked while the member is paying is not seen here, and the paid
 * place is granted anyway — the webhook reports it (billing/webhook-handler).
 */
async function assertTierDaysFree(tenantId: string, clientId: string, workshopId: string, workshopTierId: string) {
  const clash = await tierDaysClash(tenantId, clientId, workshopId, workshopTierId)
  if (clash) throw await clashError(db, tenantId, clientId, clash)
}

export async function beginWorkshopCheckout(
  tenantId: string,
  input: {
    clientId: string
    workshopId: string
    workshopTierId: string
    promoCode?: string
  },
): Promise<WorkshopCheckout> {
  const { clientId, workshopId, workshopTierId } = input

  const [tier] = await db
    .select()
    .from(workshopTiers)
    .where(
      and(
        eq(workshopTiers.tenantId, tenantId),
        eq(workshopTiers.id, workshopTierId),
        eq(workshopTiers.workshopId, workshopId),
      ),
    )
    .limit(1)
  if (!tier) throw new NotFoundError('workshop_tier_not_found')

  const [ws] = await db
    .select()
    .from(workshops)
    .where(and(eq(workshops.tenantId, tenantId), eq(workshops.id, workshopId)))
    .limit(1)
  if (!ws) throw new NotFoundError('workshop_not_found')
  await assertWorkshopOnSale(tenantId, ws)

  // One body, one session at a time: every day the tier covers must be free
  // in the member's own bookings. Asked before any money moves, since there is
  // no automated refund for a place they could not attend.
  await assertTierDaysFree(tenantId, clientId, workshopId, workshopTierId)

  const promos = await listActivePromotionsFor(tenantId, 'workshop', [workshopId])
  // Early-bird beats promotions while the cutoff is live — same rule the FE uses
  // to display the price, so what's shown is what's charged.
  const eff = tierEffectivePrice(tier, promos[workshopId] ?? [])
  const name = `${ws.name} — ${tier.name}`

  // Free workshop (price 0 after promotion) → book immediately, skip Stripe. A
  // code typed on it is still checked, so a bad one is refused rather than shown
  // accepted; there is nothing left to discount, so no place is claimed.
  const free = grantsWithoutPaying(toCents(eff.baseSgd))

  // Reject duplicates / full tiers BEFORE charging — there is no automated
  // refund flow yet, so an unbookable spot must never reach Stripe.
  if (!free) await assertWorkshopBookable(tenantId, { clientId, workshopId, workshopTierId })

  // The code stacks on top of the automatic Promotion / early bird, claims its
  // place under a row lock, and is refused outright when it does not apply.
  // Scoping is at workshop level, never workshop tier.
  let applied: AppliedPromoCode | null = null
  if (input.promoCode) {
    applied = await applyPromoCode({
      tenantId,
      codeText: input.promoCode,
      clientId,
      product: { productType: 'workshop', productId: workshopId },
      productName: name,
      basePriceSgd: eff.baseSgd,
    })
  }

  // The effective price comes from the pure module, which already floored the
  // discount at zero — re-deriving it here would be a second opinion free to
  // disagree with the one frozen onto the Redemption.
  const totalCents = toCents(applied?.effectivePriceSgd ?? eff.baseSgd)

  // Nothing left to charge — the tier was free, or the code took it to zero.
  // Book now; the Redemption is already `consumed`, no webhook is coming.
  if (grantsWithoutPaying(totalCents)) {
    const result = await bookWorkshopFree(tenantId, {
      clientId,
      workshopId,
      workshopTierId,
      appliedPromoCodeId: applied?.promoCodeId ?? null,
    })
    // A free place is still a sale — the Purchase opens and closes here,
    // because a total of zero leaves nothing outstanding.
    await openSettledPurchase({
      tenantId,
      clientId,
      kind: 'workshop',
      metadata: {
        kind: 'workshop',
        workshop_id: workshopId,
        workshop_tier_id: workshopTierId,
        client_id: clientId,
        promo_code_id: applied?.promoCodeId ?? '',
        applied_promotion_id: eff.appliedPromotionId ?? '',
      },
    })
    return { outcome: 'granted', bookingId: result.bookingId }
  }

  return {
    outcome: 'checkout',
    lines: [
      {
        name,
        description: saleDescription(await tenantDisplayName(tenantId), applied?.code),
        amountCents: totalCents,
      },
    ],
    expiresAt: applied?.holdExpiresAt ?? null,
    metadata: {
      kind: 'workshop',
      workshop_id: workshopId,
      workshop_tier_id: workshopTierId,
      client_id: clientId,
      promo_code: applied?.code ?? '',
      promo_code_id: applied?.promoCodeId ?? '',
      promo_discount_sgd: applied?.discountSgd ?? '0.00',
      applied_promotion_id: eff.appliedPromotionId ?? '',
      list_price_sgd: tier.regularPriceSgd,
      amount_sgd: (totalCents / 100).toFixed(2),
    },
  }
}
