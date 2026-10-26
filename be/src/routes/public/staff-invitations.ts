import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { tenantId } from '../../middleware/tenant'
import { acceptInvitation, lookupInvitationByToken } from '../../services/auth/invitations'
import { explainInvalid } from '../explain-invalid'

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
const nameField = (label: string) =>
  z
    .string({ message: `A ${label} must be text.` })
    .trim()
    .min(1, `Enter your ${label}.`)
    .max(100, `A ${label} can be at most 100 characters.`)
const acceptSchema = z.object({
  token: z.string({ message: 'This invitation link is missing its token.' }).min(1, 'This invitation link is missing its token.'),
  password: z.string({ message: 'A password must be text.' }).optional(),
  first_name: nameField('first name').optional(),
  last_name: nameField('last name').optional(),
})
const explainAccept = explainInvalid('That sign-up is not valid.')

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
  .post('/staff-invitation/accept', zValidator('json', acceptSchema, explainAccept), async c => {
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
