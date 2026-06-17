import { Hono } from 'hono'
import { stripe } from '../../lib/stripe'
import { handleStripeEvent } from '../../services/billing/webhook-handler'
import { logger } from '../../shared/logger'
import { captureException } from '../../instrument'

const app = new Hono().post('/stripe', async c => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return c.json({ error: 'webhook_not_configured' }, 500)

  const body = await c.req.text()
  const sig = c.req.header('stripe-signature') ?? ''

  let event: any
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret)
  } catch {
    return c.json({ error: 'invalid_webhook_signature' }, 400)
  }

  try {
    await handleStripeEvent(event)
  } catch (err) {
    logger.error({ err }, 'stripe-webhook handler error')
    captureException(err, { webhook: 'stripe', eventId: event?.id, eventType: event?.type })
    return c.json({ error: 'handler_failed' }, 500)
  }

  return c.json({ received: true })
})

export default app
