import { Hono } from 'hono'
import { stripePlatform } from '../../lib/stripe'
import { handleStripeEvent } from '../../services/billing/webhook-handler'
import { logger } from '../../shared/logger'

const app = new Hono().post('/stripe', async c => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return c.json({ error: 'webhook_not_configured' }, 500)

  const body = await c.req.text()
  const sig = c.req.header('stripe-signature') ?? ''

  let event: any
  try {
    // The platform's client, not a studio's: the signature is checked before
    // anything in the body has been trusted enough to name a Tenant.
    event = stripePlatform().webhooks.constructEvent(body, sig, secret)
  } catch {
    return c.json({ error: 'invalid_webhook_signature' }, 400)
  }

  try {
    await handleStripeEvent(event)
  } catch (err) {
    logger.error({ err, eventId: event?.id, eventType: event?.type }, 'stripe-webhook handler error')
    return c.json({ error: 'handler_failed' }, 500)
  }

  return c.json({ received: true })
})

export default app
