import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { tenantId } from '../../middleware/tenant'
import { confirmStaffEmailChange, lookupStaffEmailChange } from '../../services/auth/staff-email-change'

/**
 * Public (unauthenticated) confirmation of a staff email change, on the
 * studio's portal — where the link mailed to the new address lands.
 *
 * GET /api/v1/public/staff-email-change?token=…
 *   → { status: 'valid'|'expired'|'invalid', email }
 *
 * The confirmation page calls this to show the address before the click, and a
 * friendly state for a link that no longer works. Read-only.
 *
 * POST /api/v1/public/staff-email-change/confirm { token }
 *   → { email }
 *
 * The click: the Unverified address becomes the staff member's sign-in email.
 * Holding the link is the proof; nobody need be signed in.
 */
const tokenSchema = z.object({ token: z.string().min(1).max(512) })

const app = new Hono()
  .get('/staff-email-change', zValidator('query', tokenSchema), async c => {
    const { token } = c.req.valid('query')
    const result = await lookupStaffEmailChange(tenantId(c), token)
    return c.json({ status: result.status, email: result.email })
  })
  .post('/staff-email-change/confirm', zValidator('json', tokenSchema), async c => {
    const { token } = c.req.valid('json')
    const result = await confirmStaffEmailChange({ tenantId: tenantId(c), token })
    return c.json({ email: result.email })
  })

export default app
