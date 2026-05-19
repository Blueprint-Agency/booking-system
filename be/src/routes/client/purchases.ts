import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { stripe } from '../../lib/stripe'
import { db } from '../../db'
import { classPackages, ptPackages } from '../../db/schema/packages'
import { eq } from 'drizzle-orm'
import { validatePromoCode } from '../../lib/promo-codes'

const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:3000'

const packageCheckoutSchema = z.object({
  package_kind: z.enum(['class', 'pt']),
  package_id: z.string().uuid(),
  promo_code: z.string().optional(),
})

const workshopCheckoutSchema = z.object({
  workshop_id: z.string().uuid(),
  workshop_tier_id: z.string().uuid(),
  promo_code: z.string().optional(),
})

const validatePromoSchema = z.object({
  code: z.string().min(1),
})

const app = new Hono()

  .post('/checkout/validate-promo', zValidator('json', validatePromoSchema), c => {
    const { code } = c.req.valid('json')
    const result = validatePromoCode(code)
    if (!result.valid) {
      return c.json({ valid: false, error: 'Invalid promo code' }, 200)
    }
    return c.json({ valid: true, discountSgd: result.discountSgd, description: result.description })
  })

  .post('/checkout/package', zValidator('json', packageCheckoutSchema), async c => {
    const { package_kind, package_id, promo_code } = c.req.valid('json')
    const clientId = c.get('clientId')
    const clientRow = c.get('clientRow')

    // Resolve package
    let packageName: string
    let priceSgd: number

    if (package_kind === 'class') {
      const [pkg] = await db.select().from(classPackages)
        .where(eq(classPackages.id, package_id)).limit(1)
      if (!pkg || pkg.status !== 'active') {
        return c.json({ error: 'package_not_found' }, 404)
      }
      packageName = pkg.name
      priceSgd = parseFloat(pkg.priceSgd)
    } else {
      const [pkg] = await db.select().from(ptPackages)
        .where(eq(ptPackages.id, package_id)).limit(1)
      if (!pkg || pkg.status !== 'active') {
        return c.json({ error: 'package_not_found' }, 404)
      }
      packageName = pkg.name
      priceSgd = parseFloat(pkg.priceSgd)
    }

    // Apply promo discount before GST
    let discountSgd = 0
    if (promo_code) {
      const promo = validatePromoCode(promo_code)
      if (promo.valid) {
        discountSgd = Math.min(promo.discountSgd, priceSgd)
      }
    }
    const discountedBase = priceSgd - discountSgd
    // GST-inclusive total in cents
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
        discount_sgd: String(discountSgd),
        amount_sgd: String((totalCents / 100).toFixed(2)),
      },
      success_url: `${CLIENT_URL}/booking/confirmation?type=package&package_id=${package_id}&package_kind=${package_kind}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}/checkout?package=${package_id}&kind=${package_kind}&cancelled=1`,
    })

    // stripe_payments row is created in the webhook on checkout.session.completed
    // once we have the confirmed PaymentIntent ID and amount.

    return c.json({ url: session.url })
  })

  .post('/checkout/workshop', zValidator('json', workshopCheckoutSchema), async c => {
    void c.req.valid('json')
    return c.json({ todo: 'workshop checkout — pending schedule implementation' }, 501)
  })

  // Called by the confirmation page after Stripe redirects back.
  // Retrieves the session from Stripe and grants the package if payment succeeded.
  // This is idempotent — safe to call multiple times. It handles the case where
  // the webhook hasn't fired yet (no Stripe CLI listener in local dev).
  .post('/checkout/sync-session', zValidator('json', z.object({ session_id: z.string() })), async c => {
    const { session_id } = c.req.valid('json')
    const clientId = c.get('clientId')

    let session: any
    try {
      session = await stripe.checkout.sessions.retrieve(session_id)
    } catch {
      return c.json({ error: 'session_not_found' }, 404)
    }

    // Verify this session belongs to the authenticated client
    if (session.metadata?.client_id !== clientId) {
      return c.json({ error: 'forbidden' }, 403)
    }

    if (session.payment_status !== 'paid') {
      return c.json({ status: 'pending' })
    }

    // Delegate to the same handler the webhook uses — fully idempotent
    const { handleStripeEvent } = await import('../../services/billing/webhook-handler')
    await handleStripeEvent({
      type: 'checkout.session.completed',
      data: { object: session },
    } as any)

    return c.json({ status: 'granted' })
  })

export default app
