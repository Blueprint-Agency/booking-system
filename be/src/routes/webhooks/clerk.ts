import { Hono } from 'hono'
import { Webhook } from 'svix'
import { env } from '../../env'
import { handleClerkStaffEvent } from '../../services/auth/webhook-sync'

/**
 * Clerk → /api/v1/webhooks/clerk
 *
 * Svix signs the *raw* body, so we must verify before any JSON parse. Hono's
 * `c.req.text()` reads the raw body before any JSON middleware touches it.
 *
 * For v0 only the staff Clerk app is wired. We can't tell from a single
 * endpoint which Clerk app sent the event — the signing secret is what
 * disambiguates: we accept any event that verifies against
 * CLERK_STAFF_WEBHOOK_SECRET and treat it as staff. Client-app events will
 * land on a different signing secret once that slice exists.
 */
const app = new Hono().post('/clerk', async c => {
  const body = await c.req.text()
  const wh = new Webhook(env.CLERK_STAFF_WEBHOOK_SECRET)

  let event: { type: string; data: any }
  try {
    event = wh.verify(body, {
      'svix-id': c.req.header('svix-id') ?? '',
      'svix-timestamp': c.req.header('svix-timestamp') ?? '',
      'svix-signature': c.req.header('svix-signature') ?? '',
    }) as { type: string; data: any }
  } catch {
    return c.json({ error: 'invalid_webhook_signature' }, 400)
  }

  try {
    const outcome = await handleClerkStaffEvent(event)
    return c.json({ received: true, outcome: outcome.kind })
  } catch (err) {
    console.error('[clerk-webhook] handler error', err)
    // Return 500 so Svix retries.
    return c.json({ error: 'handler_failed' }, 500)
  }
})

export default app
