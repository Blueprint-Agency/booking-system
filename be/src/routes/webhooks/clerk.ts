import { Hono } from 'hono'
import { Webhook } from 'svix'

const app = new Hono().post('/clerk', async c => {
  const secret = process.env.CLERK_WEBHOOK_SECRET
  if (!secret) return c.json({ error: 'webhook_not_configured' }, 500)

  const body = await c.req.text()
  const wh = new Webhook(secret)
  let event: any
  try {
    event = wh.verify(body, {
      'svix-id': c.req.header('svix-id') ?? '',
      'svix-timestamp': c.req.header('svix-timestamp') ?? '',
      'svix-signature': c.req.header('svix-signature') ?? '',
    })
  } catch {
    return c.json({ error: 'invalid_webhook_signature' }, 400)
  }

  // TODO: services/auth/webhook-sync.ts — upsert clients or staff_users based on Clerk app
  // user.created — match by email against staff_invitations OR auto-create client row
  // user.updated — sync name + email
  // session.revoked — no-op
  void event

  return c.json({ received: true })
})

export default app
