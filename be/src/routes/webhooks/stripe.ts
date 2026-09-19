import { Hono } from 'hono'
import { stripe } from '../../lib/stripe'
import { OFF_REQUEST_RETRY } from '../../lib/outbound'
import { handleStripeEvent } from '../../services/billing/webhook-handler'
import { ERROR_CODES } from '../../shared/error-codes'
import { logger, setLogContext } from '../../shared/logger'

const app = new Hono().post('/stripe', async c => {
  setLogContext({ webhook: 'stripe' })
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return c.json({ error: ERROR_CODES.webhook_not_configured }, 500)

  const body = await c.req.text()
  const sig = c.req.header('stripe-signature') ?? ''

  let event: any
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret)
  } catch (err) {
    logger.warn({ reason: (err as Error)?.message }, 'stripe-webhook: signature refused')
    return c.json({ error: ERROR_CODES.invalid_webhook_signature }, 400)
  }

  try {
    // Off the request path: the provider waits for the answer, not a member.
    await handleStripeEvent(event, { retry: OFF_REQUEST_RETRY })
  } catch (err) {
    logger.error({ err, eventId: event?.id, eventType: event?.type }, 'stripe-webhook handler error')
    return c.json({ error: ERROR_CODES.handler_failed }, 500)
  }

  return c.json({ received: true })
})

export default app
