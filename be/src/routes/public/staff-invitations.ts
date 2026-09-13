import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { tenantId } from '../../middleware/tenant'
import { acceptInvitation, lookupInvitationByToken } from '../../services/auth/invitations'

/**
 * Public (unauthenticated) staff invitations, on the inviting studio's portal.
 *
 * GET /api/v1/public/staff-invitation?token=…
 *   → { status: 'valid'|'expired'|'used'|'revoked'|'not_found', email, role, password_set }
 *
 * The set-password page calls this to render the right state (and the canonical
 * invited email). Returns a structured status rather than throwing so the page
 * can render a friendly message.
 *
 * POST /api/v1/public/staff-invitation/accept { token, password?, first_name?, last_name? }
 *   → { email }
 *
 * Sets the invitee's first password and activates their staff row; the page
 * then signs in with it. `password` is not needed, and is ignored, when the
 * lookup said the invitee already has one.
 */
const querySchema = z.object({ token: z.string().min(1) })
const acceptSchema = z.object({
  token: z.string().min(1),
  password: z.string().optional(),
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
})

const app = new Hono()
  .get('/staff-invitation', zValidator('query', querySchema), async c => {
    const { token } = c.req.valid('query')
    const result = await lookupInvitationByToken(tenantId(c), token)
    return c.json({
      status: result.status,
      email: result.email,
      role: result.role,
      password_set: result.passwordSet,
    })
  })
  .post('/staff-invitation/accept', zValidator('json', acceptSchema), async c => {
    const body = c.req.valid('json')
    const result = await acceptInvitation({
      tenantId: tenantId(c),
      token: body.token,
      password: body.password,
      firstName: body.first_name,
      lastName: body.last_name,
    })
    return c.json({ email: result.email })
  })

export default app
