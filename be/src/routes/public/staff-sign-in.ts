import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { tenantId } from '../../middleware/tenant'
import { staffSignInStep } from '../../services/auth/staff-sign-in-step'

/**
 * POST /api/v1/public/staff/sign-in-step { email } → { next: 'password' | 'link_sent' }
 *
 *   The email step of a studio portal's sign-in form
 *   (`services/auth/staff-sign-in-step.ts`). `password`: ask for it and sign in
 *   at `/api/v1/auth/staff/sign-in/email`. `link_sent`: show "check your email" —
 *   a set-password link went out if the address is staff here who cannot sign
 *   in with a password yet, and nothing did otherwise; the answer is the same.
 *
 *   429 too_many_requests — per address and per email
 *
 * Public because nobody is signed in yet; it runs in the Tenant context the
 * portal's hostname named, like every other route.
 */
const emailSchema = z.object({ email: z.string().trim().email() })

const app = new Hono().post('/staff/sign-in-step', zValidator('json', emailSchema), async c => {
  const { email } = c.req.valid('json')
  return c.json(await staffSignInStep({ tenantId: tenantId(c), email, from: c.req.raw.headers }))
})

export default app
