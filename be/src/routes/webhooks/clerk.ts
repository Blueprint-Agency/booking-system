import { Hono } from 'hono'
import { Webhook } from 'svix'
import { env } from '../../env'
import { handleClerkStaffEvent, handleClerkClientEvent } from '../../services/auth/webhook-sync'
import { logger } from '../../shared/logger'
import { captureException } from '../../instrument'

/**
 * Clerk → /api/v1/webhooks/clerk
 *
 * Svix signs the *raw* body, so we must verify before any JSON parse. Hono's
 * `c.req.text()` reads the raw body before any JSON middleware touches it.
 *
 * Both Clerk apps (staff + client) point at this one endpoint. We can't tell
 * from the payload which app sent it — the signing secret disambiguates. We try
 * the staff secret first, then the client secret (if configured), and dispatch
 * to the matching handler. Whichever secret verifies wins.
 */
const app = new Hono().post('/clerk', async c => {
  const body = await c.req.text()
  const headers = {
    'svix-id': c.req.header('svix-id') ?? '',
    'svix-timestamp': c.req.header('svix-timestamp') ?? '',
    'svix-signature': c.req.header('svix-signature') ?? '',
  }

  function verifyWith(secret: string): { type: string; data: any } | null {
    try {
      return new Webhook(secret).verify(body, headers) as { type: string; data: any }
    } catch {
      return null
    }
  }

  const staffEvent = verifyWith(env.CLERK_STAFF_WEBHOOK_SECRET)
  const clientEvent =
    !staffEvent && env.CLERK_CLIENT_WEBHOOK_SECRET
      ? verifyWith(env.CLERK_CLIENT_WEBHOOK_SECRET)
      : null

  if (!staffEvent && !clientEvent) {
    return c.json({ error: 'invalid_webhook_signature' }, 400)
  }

  try {
    if (staffEvent) {
      const outcome = await handleClerkStaffEvent(staffEvent)
      return c.json({ received: true, app: 'staff', outcome: outcome.kind })
    }
    const outcome = await handleClerkClientEvent(clientEvent!)
    return c.json({ received: true, app: 'client', outcome: outcome.kind })
  } catch (err) {
    logger.error({ err }, 'clerk-webhook handler error')
    captureException(err, {
      webhook: 'clerk',
      app: staffEvent ? 'staff' : 'client',
      eventType: staffEvent?.type ?? clientEvent?.type,
    })
    // Return 500 so Svix retries.
    return c.json({ error: 'handler_failed' }, 500)
  }
})

export default app
