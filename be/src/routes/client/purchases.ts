import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { stripe } from '../../lib/stripe'
import { AppError, NotFoundError } from '../../shared/errors'
import { quoteCrossLocationAddOn } from '../../services/packages/purchase'
import {
  beginCrossLocationCheckout,
  beginPackageCheckout,
} from '../../services/packages/checkout'
import { beginWorkshopCheckout } from '../../services/workshops/checkout'
import {
  beginMerchCheckout,
  listMerchOrders,
  serializeMerchOrder,
} from '../../services/catalog/merch-orders'
import { createCheckoutSession } from '../../services/billing/checkout-session'
import { describeProduct, previewPromoCode } from '../../services/packages/promo-redemption'
import { CLIENT_URL } from '../../env'

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
    const body = c.req.valid('json')
    const quote = await beginPackageCheckout({
      clientId: c.get('clientId'),
      packageKind: body.package_kind,
      packageId: body.package_id,
      promoCode: body.promo_code,
      locationId: body.location_id,
      crossLocationAddOn: body.cross_location_add_on,
    })
    if (quote.outcome === 'granted') {
      return c.json({ outcome: 'granted', client_package_id: quote.clientPackageId, free: true }, 201)
    }
    const url = await createCheckoutSession({
      email: c.get('clientRow').email,
      lines: quote.lines,
      expiresAt: quote.expiresAt,
      metadata: quote.metadata,
      successUrl: `${CLIENT_URL}/booking/confirmation?type=package&package_id=${body.package_id}&package_kind=${body.package_kind}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${CLIENT_URL}/checkout?package=${body.package_id}&kind=${body.package_kind}&cancelled=1`,
    })
    return c.json({ url })
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
    const quote = await beginCrossLocationCheckout(
      c.get('clientId'),
      c.req.valid('json').client_package_id,
    )
    const url = await createCheckoutSession({
      email: c.get('clientRow').email,
      lines: quote.lines,
      expiresAt: null,
      metadata: quote.metadata,
      successUrl: `${CLIENT_URL}/booking/confirmation?type=cross_location&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${CLIENT_URL}/account?cancelled=1`,
    })
    return c.json({ url })
  })
  // Merch: one item, no Promo Code, no review page. Paid for online and handed
  // over at the studio, which is what the client app's notice says.
  .post('/checkout/merch', zValidator('json', z.object({ merch_id: z.string().uuid() })), async c => {
    const { merch_id } = c.req.valid('json')
    const quote = await beginMerchCheckout({ clientId: c.get('clientId'), merchId: merch_id })
    if (quote.outcome === 'granted') {
      return c.json({ outcome: 'granted', order_id: quote.orderId, free: true }, 201)
    }
    const url = await createCheckoutSession({
      email: c.get('clientRow').email,
      lines: quote.lines,
      expiresAt: quote.expiresAt,
      metadata: quote.metadata,
      successUrl: `${CLIENT_URL}/booking/confirmation?type=merch&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${CLIENT_URL}/merch?cancelled=1`,
    })
    return c.json({ url })
  })
  // Purchase history: what the member bought and is collecting at the studio.
  .get('/merch-orders', async c => {
    const rows = await listMerchOrders(c.get('clientId'))
    return c.json({ orders: rows.map(serializeMerchOrder) })
  })
  .post('/checkout/workshop', zValidator('json', checkoutWorkshopSchema), async c => {
    const body = c.req.valid('json')
    const quote = await beginWorkshopCheckout({
      clientId: c.get('clientId'),
      workshopId: body.workshop_id,
      workshopTierId: body.workshop_tier_id,
      promoCode: body.promo_code,
    })
    if (quote.outcome === 'granted') {
      return c.json({ outcome: 'granted', booking_id: quote.bookingId, free: true }, 201)
    }
    const url = await createCheckoutSession({
      email: c.get('clientRow').email,
      lines: quote.lines,
      expiresAt: quote.expiresAt,
      metadata: quote.metadata,
      successUrl: `${CLIENT_URL}/booking/confirmation?type=workshop&workshop_id=${body.workshop_id}&workshop_tier_id=${body.workshop_tier_id}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${CLIENT_URL}/checkout?workshop=${body.workshop_id}&tier=${body.workshop_tier_id}&cancelled=1`,
    })
    return c.json({ url })
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
