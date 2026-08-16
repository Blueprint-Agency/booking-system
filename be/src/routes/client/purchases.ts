import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { stripe } from '../../lib/stripe'
import { db } from '../../db'
import { classPackages, ptPackages } from '../../db/schema/packages'
import { AppError, BadRequestError, NotFoundError } from '../../shared/errors'
import {
  purchaseFreeTrial,
  assertTrialEligible,
  assertPurchasableLocation,
  grantPackage,
  priceCrossLocationForNewPlan,
  quoteCrossLocationAddOn,
} from '../../services/packages/purchase'
import {
  bestPrice,
  listActivePromotionsFor,
} from '../../services/packages/promotions'
import {
  describeProduct,
  holdPromoCode,
  previewPromoCode,
  type AppliedPromoCode,
} from '../../services/packages/promo-redemption'
import {
  assertWorkshopBookable,
  bookWorkshopFree,
  tierEffectivePrice,
} from '../../services/workshops/book'
import { workshops, workshopTiers } from '../../db/schema/schedule'
import { env } from '../../env'

const CLIENT_URL = env.CLIENT_ORIGIN ?? 'http://localhost:3000'

const checkoutPackageSchema = z.object({
  package_kind: z.enum(['class', 'pt']),
  package_id: z.string().uuid(),
  promo_code: z.string().optional(),
  /** Home Location — required for an Unlimited Plan, refused for anything else (§1). */
  location_id: z.string().uuid().optional(),
  /** Buy the Cross-Location Add-On with the plan — one session, two line items (§5). */
  cross_location_add_on: z.boolean().optional(),
})

const crossLocationSchema = z.object({
  /** The plan the Add-On attaches to. It belongs to one plan, never to a member. */
  client_package_id: z.string().uuid(),
})

// The product travels with the code (§11) — without it the endpoint cannot
// answer the scope case. Either a package or a workshop tier, never both.
const validatePromoSchema = z.intersection(
  z.object({ code: z.string().min(1) }),
  z.union([
    z.object({
      package_kind: z.enum(['class', 'pt']),
      package_id: z.string().uuid(),
    }),
    z.object({
      workshop_id: z.string().uuid(),
      workshop_tier_id: z.string().uuid(),
    }),
  ]),
)

const checkoutWorkshopSchema = z.object({
  workshop_id: z.string().uuid(),
  workshop_tier_id: z.string().uuid(),
  promo_code: z.string().optional(),
})

const app = new Hono()
  // A preview, not a claim: the place is claimed when checkout starts. A refusal
  // is an answer rather than an error, so it comes back 200 with the member's
  // own sentence — the same sentence the checkout refusal carries.
  .post('/checkout/validate-promo', zValidator('json', validatePromoSchema), async c => {
    const clientId = c.get('clientId')
    const body = c.req.valid('json')
    const item = await describeProduct(
      'package_id' in body
        ? { packageKind: body.package_kind, packageId: body.package_id }
        : { workshopId: body.workshop_id, workshopTierId: body.workshop_tier_id },
    )
    try {
      const applied = await previewPromoCode({
        codeText: body.code,
        clientId,
        product: item.product,
        productName: item.name,
        basePriceSgd: item.basePriceSgd,
      })
      return c.json({
        valid: true,
        promo_code_id: applied.promoCodeId,
        code: applied.code,
        label: applied.label,
        discount_sgd: applied.discountSgd,
        effective_price_sgd: applied.effectivePriceSgd,
      })
    } catch (err) {
      if (err instanceof AppError && err.code === 'promo_code_invalid') {
        return c.json({ valid: false, ...(err.details ?? {}) }, 200)
      }
      throw err
    }
  })
  .post('/checkout/package', zValidator('json', checkoutPackageSchema), async c => {
    const clientId = c.get('clientId')
    const clientRow = c.get('clientRow')
    const { package_kind, package_id, promo_code, location_id, cross_location_add_on } =
      c.req.valid('json')

    let packageName: string
    let priceSgd: string
    let appliedPromotionId: string | null = null
    let effectivePriceSgd: string
    let productType: 'class_package' | 'pt_package'
    /** The Add-On bought alongside the plan — its own line item and its own money. */
    let crossLocationSgd: string | null = null

    if (package_kind === 'class') {
      const [pkg] = await db
        .select()
        .from(classPackages)
        .where(and(eq(classPackages.id, package_id), isNull(classPackages.deletedAt)))
        .limit(1)
      if (!pkg) throw new NotFoundError('class_package_not_found')
      if (pkg.status !== 'active') throw new BadRequestError('class_package_not_active')

      // The grant applies these same rules, but only once the webhook fires —
      // by then the member has paid, and a refusal there charges them for
      // nothing. Same rule, run before Stripe.
      await assertPurchasableLocation(clientId, pkg.kind, location_id)

      // The Add-On on a plan being bought now (§5). A new plan has its whole
      // Duration ahead of it whether it starts today or waits Dormant, so it
      // prices at the stored Duration with no arithmetic.
      if (cross_location_add_on) {
        crossLocationSgd = await priceCrossLocationForNewPlan(pkg.kind, pkg.durationMonths)
      }

      const promos = await listActivePromotionsFor('class_package', [pkg.id])
      const eff = bestPrice(pkg.priceSgd, promos[pkg.id] ?? [])

      // Trial pass: new-member-only + once-per-client. Gate BEFORE any charge.
      if (pkg.kind === 'trial') {
        await assertTrialEligible(clientId)
        // A $0 trial is granted immediately (no Stripe). A priced trial falls
        // through to the standard paid-class-package Checkout below.
        if (Number(eff.effectivePriceSgd) <= 0) {
          const result = await purchaseFreeTrial(clientId, pkg.id)
          return c.json(
            {
              outcome: 'granted',
              client_package_id: result.clientPackageId,
              free: true,
            },
            201,
          )
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
        .where(and(eq(ptPackages.id, package_id), isNull(ptPackages.deletedAt)))
        .limit(1)
      if (!pkg) throw new NotFoundError('pt_package_not_found')
      if (pkg.status !== 'active') throw new BadRequestError('pt_package_not_active')
      await assertPurchasableLocation(clientId, 'pt', location_id)
      if (cross_location_add_on) await priceCrossLocationForNewPlan('pt', null)

      const promos = await listActivePromotionsFor('pt_package', [pkg.id])
      const eff = bestPrice(pkg.priceSgd, promos[pkg.id] ?? [])
      packageName = pkg.name
      priceSgd = pkg.priceSgd
      appliedPromotionId = eff.appliedPromotionId
      effectivePriceSgd = eff.effectivePriceSgd
      productType = 'pt_package'
    }

    // The Promo Code stacks on top of the automatic Promotion, which is already
    // baked into `effectivePriceSgd`. This claims the place under a row lock, so
    // a code that has run out is refused HERE rather than after payment; a bad
    // code is refused too, never ignored into a full-price charge.
    // All money math in integer cents — float arithmetic drifts on edge cases.
    const baseCents = Math.round(parseFloat(effectivePriceSgd) * 100)
    let applied: AppliedPromoCode | null = null
    if (promo_code) {
      const args = {
        codeText: promo_code,
        clientId,
        product: { productType, productId: package_id },
        productName: packageName,
        basePriceSgd: effectivePriceSgd,
      }
      // A line a Promotion already took to zero has nothing left to discount, so
      // the code is checked but no place is claimed and nothing is frozen onto
      // the purchase — a member does not spend their one use on something it
      // cannot reduce. A bad code is refused either way, never silently accepted.
      if (baseCents > 0) applied = await holdPromoCode(args)
      else await previewPromoCode(args)
    }
    // Catalogue prices are GST-inclusive (SG consumer pricing / IRAS). The amount
    // charged IS the listed price; the "includes 9% GST" line reflects the embedded
    // GST rather than adding it on top.
    // The effective price comes from the pure module, which already floored the
    // discount at zero — re-deriving it here would be a second opinion free to
    // disagree with the one frozen onto the Redemption.
    const planCents = applied
      ? Math.round(Number(applied.effectivePriceSgd) * 100)
      : baseCents
    // The Add-On is a Global Policy rate, not a product — `promo_code_products`
    // has nothing to attach to, so a code discounts the plan line only and the
    // rate is never quietly shaved (§5). Plan plus Add-On IS the charge.
    const crossLocationCents = crossLocationSgd ? Math.round(Number(crossLocationSgd) * 100) : 0
    const totalCents = planCents + crossLocationCents

    // A discount that takes the total to zero skips the payment provider
    // entirely and grants immediately — the same path a free trial pass takes.
    // The Redemption was already written straight to `consumed`, because there
    // is no webhook coming to flip it.
    if (totalCents <= 0) {
      const granted = await grantPackage({
        clientId,
        paymentIntentId: null,
        amountSgd: '0.00',
        packageKind: package_kind,
        packageId: package_id,
        appliedPromotionId,
        appliedPromoCodeId: applied?.promoCodeId ?? null,
        locationId: location_id ?? null,
        crossLocationPaidSgd: crossLocationSgd,
      })
      return c.json(
        { outcome: 'granted', client_package_id: granted.clientPackageId, free: true },
        201,
      )
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: clientRow.email,
      line_items: [
        // A plan a discount took to zero beside a paid Add-On still charges: the
        // plan line is dropped rather than sent at zero, which Stripe refuses.
        ...(planCents > 0
          ? [
              {
                price_data: {
                  currency: 'sgd' as const,
                  unit_amount: planCents,
                  product_data: {
                    name: packageName,
                    description: `Yoga Sadhana · includes 9% GST${applied ? ` · promo ${applied.code} applied` : ''}`,
                  },
                },
                quantity: 1,
              },
            ]
          : []),
        // Its own line, never folded into the plan — that fold is what would
        // make "is the Add-On selling?" unanswerable (§15).
        ...(crossLocationCents > 0
          ? [
              {
                price_data: {
                  currency: 'sgd' as const,
                  unit_amount: crossLocationCents,
                  product_data: {
                    name: 'Cross-Location Add-On',
                    description: 'Covers both studios for the length of this plan · includes 9% GST',
                  },
                },
                quantity: 1,
              },
            ]
          : []),
      ],
      // A capped code's session dies at the same moment its Hold does, so a
      // member can never pay for a place that has already gone back in the pool.
      // An uncapped or code-free checkout keeps the standard 24 hours.
      ...(applied?.holdExpiresAt
        ? { expires_at: Math.floor(applied.holdExpiresAt.getTime() / 1000) }
        : {}),
      metadata: {
        kind: package_kind === 'class' ? 'class_package' : 'pt_package',
        package_id,
        client_id: clientId,
        promo_code: applied?.code ?? '',
        promo_code_id: applied?.promoCodeId ?? '',
        promo_discount_sgd: applied?.discountSgd ?? '0.00',
        applied_promotion_id: appliedPromotionId ?? '',
        list_price_sgd: priceSgd,
        location_id: location_id ?? '',
        // The plan's money and the Add-On's money, split without overlap: the
        // two together are the charge, and each stays separately reportable.
        amount_sgd: (planCents / 100).toFixed(2),
        cross_location_sgd: crossLocationSgd ?? '',
      },
      success_url: `${CLIENT_URL}/booking/confirmation?type=package&package_id=${package_id}&package_kind=${package_kind}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}/checkout?package=${package_id}&kind=${package_kind}&cancelled=1`,
    })

    return c.json({ url: session.url })
  })
  // The Add-On bought later against a plan the member already holds (§5). Its
  // own session, told apart by the `kind` metadata, which names the plan the
  // webhook must fill the column on. A quote first, so the member sees the
  // months-times-rate arithmetic before they are asked to pay it.
  .post('/checkout/cross-location/quote', zValidator('json', crossLocationSchema), async c => {
    const q = await quoteCrossLocationAddOn(c.get('clientId'), c.req.valid('json').client_package_id)
    return c.json({
      client_package_id: q.clientPackageId,
      months: q.months,
      rate_sgd: q.rateSgd,
      price_sgd: q.priceSgd,
    })
  })
  .post('/checkout/cross-location', zValidator('json', crossLocationSchema), async c => {
    const clientId = c.get('clientId')
    const clientRow = c.get('clientRow')
    const { client_package_id } = c.req.valid('json')

    // Refuses a plan that is not the member's, not Unlimited, not live, or
    // already carrying one — before Stripe, never after.
    const quote = await quoteCrossLocationAddOn(clientId, client_package_id)
    const totalCents = Math.round(Number(quote.priceSgd) * 100)
    if (totalCents <= 0) throw new BadRequestError('cross_location_nothing_to_charge')

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: clientRow.email,
      line_items: [
        {
          price_data: {
            currency: 'sgd',
            unit_amount: totalCents,
            product_data: {
              name: 'Cross-Location Add-On',
              description: `${quote.months} month${quote.months === 1 ? '' : 's'} × $${quote.rateSgd} · includes 9% GST`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        kind: 'cross_location_add_on',
        client_id: clientId,
        client_package_id,
        amount_sgd: quote.priceSgd,
      },
      success_url: `${CLIENT_URL}/booking/confirmation?type=cross_location&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}/account?cancelled=1`,
    })

    return c.json({ url: session.url })
  })
  .post('/checkout/workshop', zValidator('json', checkoutWorkshopSchema), async c => {
    const clientId = c.get('clientId')
    const clientRow = c.get('clientRow')
    const { workshop_id, workshop_tier_id, promo_code } = c.req.valid('json')

    const [tier] = await db
      .select()
      .from(workshopTiers)
      .where(and(eq(workshopTiers.id, workshop_tier_id), eq(workshopTiers.workshopId, workshop_id)))
      .limit(1)
    if (!tier) throw new NotFoundError('workshop_tier_not_found')

    const [ws] = await db.select().from(workshops).where(eq(workshops.id, workshop_id)).limit(1)
    if (!ws) throw new NotFoundError('workshop_not_found')
    if (ws.lifecycle !== 'active') throw new BadRequestError('workshop_not_active')

    const promos = await listActivePromotionsFor('workshop', [workshop_id])
    // Early-bird beats promotions while the cutoff is live — same rule the
    // FE uses to display the price, so what's shown is what's charged.
    const eff = tierEffectivePrice(tier, promos[workshop_id] ?? [])
    const baseCents = Math.round(parseFloat(eff.baseSgd) * 100)

    // Free workshop (price 0 after promotion) → book immediately, skip Stripe.
    // A code typed on it is still checked, so a bad one is refused rather than
    // shown accepted; there is nothing left to discount, so no place is claimed.
    if (baseCents === 0) {
      if (promo_code) {
        await previewPromoCode({
          codeText: promo_code,
          clientId,
          product: { productType: 'workshop', productId: workshop_id },
          productName: `${ws.name} — ${tier.name}`,
          basePriceSgd: eff.baseSgd,
        })
      }
      const result = await bookWorkshopFree({ clientId, workshopId: workshop_id, workshopTierId: workshop_tier_id })
      return c.json({ outcome: 'granted', booking_id: result.bookingId, free: true }, 201)
    }

    // Reject duplicates / full tiers BEFORE charging — there is no automated
    // refund flow yet, so an unbookable spot must never reach Stripe.
    await assertWorkshopBookable({ clientId, workshopId: workshop_id, workshopTierId: workshop_tier_id })

    // The code stacks on top of the automatic Promotion / early bird, claims its
    // place under a row lock, and is refused outright when it does not apply.
    // Scoping is at workshop level, never workshop tier.
    let applied: AppliedPromoCode | null = null
    if (promo_code) {
      applied = await holdPromoCode({
        codeText: promo_code,
        clientId,
        product: { productType: 'workshop', productId: workshop_id },
        productName: `${ws.name} — ${tier.name}`,
        basePriceSgd: eff.baseSgd,
      })
    }
    // GST-inclusive (see package checkout above) — charge the listed price.
    // The effective price comes from the pure module, which already floored the
    // discount at zero — re-deriving it here would be a second opinion free to
    // disagree with the one frozen onto the Redemption.
    const totalCents = applied
      ? Math.round(Number(applied.effectivePriceSgd) * 100)
      : baseCents

    // Taken to zero by the code: skip the payment provider and book now. The
    // Redemption is already `consumed`; no webhook is coming.
    if (totalCents <= 0) {
      const result = await bookWorkshopFree({
        clientId,
        workshopId: workshop_id,
        workshopTierId: workshop_tier_id,
        appliedPromoCodeId: applied?.promoCodeId ?? null,
      })
      return c.json({ outcome: 'granted', booking_id: result.bookingId, free: true }, 201)
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: clientRow.email,
      line_items: [
        {
          price_data: {
            currency: 'sgd',
            unit_amount: totalCents,
            product_data: {
              name: `${ws.name} — ${tier.name}`,
              description: `Yoga Sadhana · includes 9% GST${applied ? ` · promo ${applied.code} applied` : ''}`,
            },
          },
          quantity: 1,
        },
      ],
      // The Hold and the session end together for a capped code (see above).
      ...(applied?.holdExpiresAt
        ? { expires_at: Math.floor(applied.holdExpiresAt.getTime() / 1000) }
        : {}),
      metadata: {
        kind: 'workshop',
        workshop_id,
        workshop_tier_id,
        client_id: clientId,
        promo_code: applied?.code ?? '',
        promo_code_id: applied?.promoCodeId ?? '',
        promo_discount_sgd: applied?.discountSgd ?? '0.00',
        applied_promotion_id: eff.appliedPromotionId ?? '',
        list_price_sgd: tier.regularPriceSgd,
        amount_sgd: (totalCents / 100).toFixed(2),
      },
      success_url: `${CLIENT_URL}/booking/confirmation?type=workshop&workshop_id=${workshop_id}&workshop_tier_id=${workshop_tier_id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}/checkout?workshop=${workshop_id}&tier=${workshop_tier_id}&cancelled=1`,
    })

    return c.json({ url: session.url })
  })
  // Called by the confirmation page after Stripe redirects back.
  // Idempotent — safe to call multiple times. Handles the case where the webhook
  // hasn't fired yet (no Stripe CLI listener in local dev).
  .post('/checkout/sync-session', zValidator('json', z.object({ session_id: z.string() })), async c => {
    const { session_id } = c.req.valid('json')
    const clientId = c.get('clientId')

    let session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>
    try {
      session = await stripe.checkout.sessions.retrieve(session_id)
    } catch {
      throw new NotFoundError('session_not_found')
    }

    if (session.metadata?.client_id !== clientId) {
      return c.json({ error: 'forbidden' }, 403)
    }

    if (session.payment_status !== 'paid') {
      return c.json({ status: 'pending' })
    }

    const { handleStripeEvent } = await import('../../services/billing/webhook-handler')
    await handleStripeEvent({
      type: 'checkout.session.completed',
      data: { object: session },
    } as any)

    return c.json({ status: 'granted' })
  })

export default app
