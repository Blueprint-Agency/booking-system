import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { lookupInvitationByToken } from '../../services/auth/invitations'

/**
 * Public (unauthenticated) staff-invitation lookup.
 *
 * GET /api/v1/public/staff-invitation?token=…
 *   → { status: 'valid'|'expired'|'used'|'revoked'|'not_found', email, role }
 *
 * The signup page calls this to render the right state (and the canonical
 * invited email) before showing Clerk's sign-up form. Returns a structured
 * status rather than throwing so the page can render a friendly message.
 */
const querySchema = z.object({ token: z.string().min(1) })

const app = new Hono().get('/staff-invitation', zValidator('query', querySchema), async c => {
  const { token } = c.req.valid('query')
  const result = await lookupInvitationByToken(token)
  return c.json(result)
})

export default app
