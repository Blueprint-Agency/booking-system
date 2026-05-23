import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { stripe } from '../../lib/stripe'
import { db } from '../../db'
import { classPackages, ptPackages } from '../../db/schema/packages'
import { requireVerified } from '../../middleware/clerk-client'
import { BadRequestError, NotFoundError } from '../../shared/errors'
import { purchaseFreeTrial } from '../../services/packages/purchase'
import {
  bestPrice,
  listActivePromotionsFor,
} from '../../services/packages/promotions'
import { validatePromoCode } from '../../lib/promo-codes'
import { env } from '../../env'

const CLIENT_URL = env.CLIENT_ORIGIN ?? 'http://localhost:3000'

const checkoutPackageSchema = z.object({
  package_kind: z.enum(['class', 'pt']),
  package_id: z.string().uuid(),
  promo_code: z.string().optional(),
})

const validatePromoSchema = z.object({
  code: z.string().min(1),
})

const app = new Hono()
  .post('/checkout/validate-promo', requireVerified, zValidator('json', validatePromoSchema), c => {
    const { code } = c.req.valid('json')
    const result = validatePromoCode(code)
    if (!result.valid) {
      return c.json({ valid: false, error: 'Invalid promo code' }, 200)
    }
    return c.json({ valid: true, discountSgd: result.discountSgd, description: result.description })
  })
  .post('/checkout/package', requireVerified, zValidator('json', checkoutPackageSchema), async c => {
    const clientId = c.get('clientId')
    const clientRow = c.get('clientRow')
    const { package_kind, package_id, promo_code } = c.req.valid('json')

    let packageName: string
    let priceSgd: string
    let appliedPromotionId: string | null = null
    let effectivePriceSgd: string

    if (package_kind === 'class') {
      const [pkg] = await db
        .select()
        .from(classPackages)
        .where(eq(classPackages.id, package_id))
        .limit(1)
      if (!pkg) throw new NotFoundError('class_package_not_found')
      if (pkg.status !== 'active') throw new BadRequestError('class_package_not_active')

      // Trial pass → free, no Stripe. Grant immediately.
      if (pkg.kind === 'trial') {
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

      const promos = await listActivePromotionsFor('class_package', [pkg.id])
      const eff = bestPrice(pkg.priceSgd, promos[pkg.id] ?? [])
      packageName = pkg.name
      priceSgd = pkg.priceSgd
      appliedPromotionId = eff.appliedPromotionId
      effectivePriceSgd = eff.effectivePriceSgd
    } else {
      const [pkg] = await db
        .select()
        .from(ptPackages)
        .where(eq(ptPackages.id, package_id))
        .limit(1)
      if (!pkg) throw new NotFoundError('pt_package_not_found')
      if (pkg.status !== 'active') throw new BadRequestError('pt_package_not_active')

      const promos = await listActivePromotionsFor('pt_package', [pkg.id])
      const eff = bestPrice(pkg.priceSgd, promos[pkg.id] ?? [])
      packageName = pkg.name
      priceSgd = pkg.priceSgd
      appliedPromotionId = eff.appliedPromotionId
      effectivePriceSgd = eff.effectivePriceSgd
    }

    // Apply user-entered promo code on top of any automatic promotion.
    let promoDiscountSgd = 0
    const baseAfterPromotion = parseFloat(effectivePriceSgd)
    if (promo_code) {
      const promo = validatePromoCode(promo_code)
      if (promo.valid) {
        promoDiscountSgd = Math.min(promo.discountSgd, baseAfterPromotion)
      }
    }
    const discountedBase = baseAfterPromotion - promoDiscountSgd
    const totalCents = Math.round(discountedBase * 1.09 * 100)

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: clientRow.email,
      line_items: [
        {
          price_data: {
            currency: 'sgd',
            unit_amount: totalCents,
            product_data: {
              name: packageName,
              description: `Yoga Sadhana · includes 9% GST${promo_code ? ` · promo ${promo_code.toUpperCase()} applied` : ''}`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        kind: package_kind === 'class' ? 'class_package' : 'pt_package',
        package_id,
        client_id: clientId,
        promo_code: promo_code ?? '',
        promo_discount_sgd: String(promoDiscountSgd),
        applied_promotion_id: appliedPromotionId ?? '',
        list_price_sgd: priceSgd,
        amount_sgd: String((totalCents / 100).toFixed(2)),
      },
      success_url: `${CLIENT_URL}/booking/confirmation?type=package&package_id=${package_id}&package_kind=${package_kind}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}/checkout?package=${package_id}&kind=${package_kind}&cancelled=1`,
    })

    return c.json({ url: session.url })
  })
  .post('/checkout/workshop', requireVerified, c =>
    c.json({ todo: 'create Stripe Payment Intent for workshop (free workshops bypass)' }, 501),
  )
  // Called by the confirmation page after Stripe redirects back.
  // Idempotent — safe to call multiple times. Handles the case where the webhook
  // hasn't fired yet (no Stripe CLI listener in local dev).
  .post('/checkout/sync-session', requireVerified, zValidator('json', z.object({ session_id: z.string() })), async c => {
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
