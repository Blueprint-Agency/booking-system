import { Hono } from 'hono'
import { stripePlatform } from '../../lib/stripe'
import { verifyTenantDelivery } from '../../services/billing/webhook-verification'
import { resolveTenantBySlug } from '../../services/tenants/tenants'
import { handleStripeEvent } from '../../services/billing/webhook-handler'
import { logger } from '../../shared/logger'

/**
 * The payment provider's deliveries, on two endpoints.
 *
 * `/stripe` is the platform's own account, and it is what every studio used
 * before #100 and what a studio still uses until it supplies credentials of its
 * own. One endpoint, one signing secret, and the studio is worked out afterwards
 * from the signed body.
 *
 * `/stripe/:slug` is a studio's own account, and the slug is there because the
 * signature check needs an answer *first*. Each studio's account signs with its
 * own secret, so "which studio is this?" has to be settled before anything in
 * the body can be trusted — and the body is exactly what cannot be read yet.
 * The URL is the only part of a delivery that is fixed when the endpoint is
 * registered on the studio's account, so the URL carries the studio.
 *
 * That ordering is also what makes a cross-studio delivery impossible rather
 * than merely unlikely. One slug selects one secret; a delivery signed by
 * another studio's account fails the check and is refused. No secret is ever
 * tried second.
 */
const app = new Hono()
  .post('/stripe', async c => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!secret) return c.json({ error: 'webhook_not_configured' }, 500)

    const body = await c.req.text()
    const sig = c.req.header('stripe-signature') ?? ''

    let event: any
    try {
      // The platform's client, not a studio's: this endpoint belongs to the
      // platform account, and the signature is checked before anything in the
      // body has been trusted enough to name a Tenant.
      event = stripePlatform().webhooks.constructEvent(body, sig, secret)
    } catch {
      return c.json({ error: 'invalid_webhook_signature' }, 400)
    }

    try {
      await handleStripeEvent(event)
    } catch (err) {
      logger.error(
        { err, eventId: event?.id, eventType: event?.type },
        'stripe-webhook handler error',
      )
      return c.json({ error: 'handler_failed' }, 500)
    }

    return c.json({ received: true })
  })

  /**
   * A studio's own account delivering to its own endpoint.
   *
   * Every refusal here is the same shape on purpose — an unknown slug, a studio
   * that has no account of its own, and a bad signature are all a flat 400 with
   * no detail. An endpoint that answered differently would let anyone with a
   * URL enumerate which studios exist and which of them take their own money.
   */
  .post('/stripe/:slug', async c => {
    const slug = c.req.param('slug')
    const body = await c.req.text()
    const sig = c.req.header('stripe-signature') ?? ''

    const resolved = await resolveTenantBySlug(slug)
    if (!resolved) return c.json({ error: 'invalid_webhook_signature' }, 400)
    const tenantId = resolved.tenant.id

    const event = await verifyTenantDelivery(tenantId, body, sig)
    if (!event) return c.json({ error: 'invalid_webhook_signature' }, 400)

    try {
      // The studio the URL named, carried through: the handler routes off the
      // signed body, and a body that routes anywhere else is a delivery this
      // endpoint has no business acting on.
      await handleStripeEvent(event, tenantId)
    } catch (err) {
      logger.error({ err, tenantId }, 'stripe-webhook handler error')
      captureException(err, {
        webhook: 'stripe',
        tenantId,
        eventId: event?.id,
        eventType: event?.type,
      })
      return c.json({ error: 'handler_failed' }, 500)
    }

    return c.json({ received: true })
  })

export default app
