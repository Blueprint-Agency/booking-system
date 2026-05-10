import { Hono } from 'hono'
import { stripe } from '../../lib/stripe'

const app = new Hono().post('/stripe', async c => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return c.json({ error: 'webhook_not_configured' }, 500)

  const body = await c.req.text()
  const sig = c.req.header('stripe-signature') ?? ''

  let event: any
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret)
  } catch (err) {
    return c.json({ error: 'invalid_webhook_signature' }, 400)
  }

  // TODO: services/billing/webhook-handler.ts
  // payment_intent.succeeded — grant client_packages or insert workshop booking;
  //   set stripe_payments.status='succeeded', receipt_url; trigger referral conversion check
  // charge.refunded — set stripe_payments.status='refunded', refunded_at
  void event

  return c.json({ received: true })
})

export default app
