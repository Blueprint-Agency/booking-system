/**
 * What a package purchase costs and what happens next (§5, §10, §11).
 *
 * The route asks this and formats the answer. Deciding the price of a plan plus
 * its Add-On, and deciding that a purchase with nothing left to charge skips the
 * payment provider and grants immediately, are domain rules — held here so the
 * client path and the webhook that follows it cannot drift apart.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { classPackages, ptPackages } from '../../db/schema/packages'
import { BadRequestError, NotFoundError } from '../../shared/errors'
import { toCents } from '../../shared/money'
import {
  grantsWithoutPaying,
  saleDescription,
  type CheckoutLine,
  type CheckoutQuote,
} from '../billing/checkout-session'
import { bestPrice, listActivePromotionsFor } from './promotions'
import { applyPromoCode, type AppliedPromoCode } from './promo-redemption'
import {
  assertPurchasableLocation,
  assertTrialEligible,
  grantFreePurchase,
  priceCrossLocationForNewPlan,
  purchaseFreeTrial,
  quoteCrossLocationAddOn,
} from './purchase'

/**
 * The lines a plan-plus-Add-On purchase charges, and the charge itself. Pure, so
 * the property the Add-On depends on is checkable without a database: the Add-On
 * is a Global Policy rate, not a product — `promo_code_products` has nothing to
 * attach to, so a code discounts the plan line only and the rate is never
 * quietly shaved (§5, story 96).
 */
export function purchaseLines(args: {
  planName: string
  /** The plan's price after any Promotion and any Promo Code. */
  planSgd: string
  /** The Add-On bought alongside the plan, or null when it was not. */
  crossLocationSgd: string | null
  promoCode?: string | null
}): { lines: CheckoutLine[]; planCents: number; crossLocationCents: number; totalCents: number } {
  const planCents = toCents(args.planSgd)
  const crossLocationCents = args.crossLocationSgd ? toCents(args.crossLocationSgd) : 0
  const lines: CheckoutLine[] = []
  // A plan a discount took to zero beside a paid Add-On still charges: the plan
  // line is dropped rather than sent at zero, which Stripe refuses.
  if (planCents > 0) {
    lines.push({
      name: args.planName,
      description: saleDescription(args.promoCode),
      amountCents: planCents,
    })
  }
  // Its own line, never folded into the plan — that fold is what would make "is
  // the Add-On selling?" unanswerable (§15).
  if (crossLocationCents > 0) {
    lines.push({
      name: 'Cross-Location Add-On',
      description: 'Covers both studios for the length of this plan',
      amountCents: crossLocationCents,
    })
  }
  return { lines, planCents, crossLocationCents, totalCents: planCents + crossLocationCents }
}

export interface PackageCheckoutInput {
  clientId: string
  packageKind: 'class' | 'pt'
  packageId: string
  promoCode?: string
  /** Home Location — required for an Unlimited Plan, refused for anything else (§1). */
  locationId?: string
  /** Buy the Cross-Location Add-On with the plan — one session, two line items (§5). */
  crossLocationAddOn?: boolean
}

export type PackageCheckout = CheckoutQuote<{ clientPackageId: string }>

export async function beginPackageCheckout(input: PackageCheckoutInput): Promise<PackageCheckout> {
  const { clientId, packageKind, packageId, locationId } = input

  let packageName: string
  let priceSgd: string
  let appliedPromotionId: string | null = null
  let effectivePriceSgd: string
  let productType: 'class_package' | 'pt_package'
  /** The Add-On bought alongside the plan — its own line item and its own money. */
  let crossLocationSgd: string | null = null

  if (packageKind === 'class') {
    const [pkg] = await db
      .select()
      .from(classPackages)
      .where(and(eq(classPackages.id, packageId), isNull(classPackages.deletedAt)))
      .limit(1)
    if (!pkg) throw new NotFoundError('class_package_not_found')
    if (pkg.status !== 'active') throw new BadRequestError('class_package_not_active')

    // The grant applies these same rules, but only once the webhook fires — by
    // then the member has paid, and a refusal there charges them for nothing.
    // Same rule, run before Stripe.
    await assertPurchasableLocation(clientId, pkg.kind, locationId)

    // The Add-On on a plan being bought now (§5). A new plan has its whole
    // Duration ahead of it whether it starts today or waits Dormant, so it
    // prices at the stored Duration with no arithmetic.
    if (input.crossLocationAddOn) {
      crossLocationSgd = await priceCrossLocationForNewPlan(
        pkg.tenantId!,
        pkg.kind,
        pkg.durationMonths,
      )
    }

    const promos = await listActivePromotionsFor('class_package', [pkg.id])
    const eff = bestPrice(pkg.priceSgd, promos[pkg.id] ?? [])

    // Trial pass: new-member-only + once-per-client. Gate BEFORE any charge.
    if (pkg.kind === 'trial') {
      await assertTrialEligible(clientId)
      // A $0 trial is granted immediately (no Stripe). A priced trial falls
      // through to the standard paid-class-package Checkout below.
      if (grantsWithoutPaying(toCents(eff.effectivePriceSgd))) {
        const result = await purchaseFreeTrial(clientId, pkg.id)
        return { outcome: 'granted', clientPackageId: result.clientPackageId }
      }
    }

    packageName = pkg.name
    priceSgd = pkg.priceSgd
    appliedPromotionId = eff.appliedPromotionId
    effectivePriceSgd = eff.effectivePriceSgd
    productType = 'class_package'
  } else {
    const [pkg] = await db
      .select()
      .from(ptPackages)
      .where(and(eq(ptPackages.id, packageId), isNull(ptPackages.deletedAt)))
      .limit(1)
    if (!pkg) throw new NotFoundError('pt_package_not_found')
    if (pkg.status !== 'active') throw new BadRequestError('pt_package_not_active')
    await assertPurchasableLocation(clientId, 'pt', locationId)
    if (input.crossLocationAddOn) await priceCrossLocationForNewPlan(pkg.tenantId!, 'pt', null)

    const promos = await listActivePromotionsFor('pt_package', [pkg.id])
    const eff = bestPrice(pkg.priceSgd, promos[pkg.id] ?? [])
    packageName = pkg.name
    priceSgd = pkg.priceSgd
    appliedPromotionId = eff.appliedPromotionId
    effectivePriceSgd = eff.effectivePriceSgd
    productType = 'pt_package'
  }

  // The Promo Code stacks on top of the automatic Promotion, which is already
  // baked into `effectivePriceSgd`. Claiming the place is what refuses a code
  // that has run out HERE rather than after payment; a bad code is refused too,
  // never ignored into a full-price charge.
  let applied: AppliedPromoCode | null = null
  if (input.promoCode) {
    applied = await applyPromoCode({
      codeText: input.promoCode,
      clientId,
      product: { productType, productId: packageId },
      productName: packageName,
      basePriceSgd: effectivePriceSgd,
    })
  }

  // The effective price comes from the pure module, which already floored the
  // discount at zero — re-deriving it here would be a second opinion free to
  // disagree with the one frozen onto the Redemption.
  const charge = purchaseLines({
    planName: packageName,
    planSgd: applied?.effectivePriceSgd ?? effectivePriceSgd,
    crossLocationSgd,
    promoCode: applied?.code,
  })

  // A discount that takes the total to zero skips the payment provider entirely
  // and grants immediately — the same path a free trial pass takes. The
  // Redemption was already written straight to `consumed`, because there is no
  // webhook coming to flip it.
  if (grantsWithoutPaying(charge.totalCents)) {
    const granted = await grantFreePurchase({
      clientId,
      paymentIntentId: null,
      amountSgd: '0.00',
      packageKind,
      packageId,
      appliedPromotionId,
      appliedPromoCodeId: applied?.promoCodeId ?? null,
      locationId: locationId ?? null,
      crossLocationPaidSgd: crossLocationSgd,
    })
    return { outcome: 'granted', clientPackageId: granted.clientPackageId }
  }

  return {
    outcome: 'checkout',
    lines: charge.lines,
    expiresAt: applied?.holdExpiresAt ?? null,
    metadata: {
      kind: productType,
      package_id: packageId,
      client_id: clientId,
      promo_code: applied?.code ?? '',
      promo_code_id: applied?.promoCodeId ?? '',
      promo_discount_sgd: applied?.discountSgd ?? '0.00',
      applied_promotion_id: appliedPromotionId ?? '',
      list_price_sgd: priceSgd,
      location_id: locationId ?? '',
      // The plan's money and the Add-On's money, split without overlap: the two
      // together are the charge, and each stays separately reportable.
      amount_sgd: (charge.planCents / 100).toFixed(2),
      cross_location_sgd: crossLocationSgd ?? '',
    },
  }
}

/**
 * The Add-On bought later against a plan the member already holds (§5). Its own
 * session, told apart by the `kind` metadata, which names the plan the webhook
 * must fill the column on. It carries no Promo Code and can never be free: the
 * Global Policy rate is what it is, so nothing left to charge is a refusal here
 * rather than a grant.
 */
export async function beginCrossLocationCheckout(
  clientId: string,
  clientPackageId: string,
): Promise<{ lines: CheckoutLine[]; metadata: Record<string, string> }> {
  // Refuses a plan that is not the member's, not Unlimited, not live, or already
  // carrying one — before Stripe, never after.
  const quote = await quoteCrossLocationAddOn(clientId, clientPackageId)
  const totalCents = toCents(quote.priceSgd)
  if (grantsWithoutPaying(totalCents)) throw new BadRequestError('cross_location_nothing_to_charge')
  return {
    lines: [
      {
        name: 'Cross-Location Add-On',
        description: `${quote.months} month${quote.months === 1 ? '' : 's'} × $${quote.rateSgd}`,
        amountCents: totalCents,
      },
    ],
    metadata: {
      kind: 'cross_location_add_on',
      client_id: clientId,
      client_package_id: clientPackageId,
      amount_sgd: quote.priceSgd,
    },
  }
}
