import { Hono } from 'hono'
import { Resend } from 'resend'
import { env } from '../../env'
import { handleResendEvent } from '../../services/notifications/delivery-outcomes'
import { logger } from '../../shared/logger'
import { captureException } from '../../instrument'

// Only for its `webhooks.verify` (Svix signatures); nothing is sent from here.
const resend = new Resend(env.RESEND_API_KEY)

const app = new Hono().post('/resend', async c => {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return c.json({ error: 'webhook_not_configured' }, 500)

  // The raw body: the signature covers these exact bytes, not a re-serialisation.
  const body = await c.req.text()

  // Resend sends Svix's `svix-*` names; the Standard Webhooks `webhook-*` names are the same values.
  const header = (name: string) => c.req.header(`svix-${name}`) ?? c.req.header(`webhook-${name}`) ?? ''

  let event: any
  try {
    event = resend.webhooks.verify({
      payload: body,
      headers: { id: header('id'), timestamp: header('timestamp'), signature: header('signature') },
      webhookSecret: secret,
    })
  } catch {
    return c.json({ error: 'invalid_webhook_signature' }, 400)
  }

  try {
    await handleResendEvent(event)
  } catch (err) {
    logger.error({ err }, 'resend-webhook handler error')
    captureException(err, { webhook: 'resend', eventType: event?.type })
    return c.json({ error: 'handler_failed' }, 500)
  }

  return c.json({ received: true })
})

export default app
