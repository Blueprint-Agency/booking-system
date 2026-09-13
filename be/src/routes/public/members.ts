import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { tenantId } from '../../middleware/tenant'
import { registerMember } from '../../services/clients/register'

/**
 * Member self-registration, on the studio's own member app (#117).
 *
 * POST /api/v1/public/members/register { email, otp, first_name, last_name, phone }
 *   → { token }
 *
 * The page first asks the client pool for a code
 * (`/api/v1/auth/client/email-otp/send-verification-otp`, type `sign-in`), then
 * sends it here with the details. The answer is a signed-in session at this
 * studio — the same bearer token a sign-in returns, also in `set-auth-token`.
 *
 *   400 invalid_otp | otp_expired — nothing written but the attempt
 *   403 too_many_attempts
 *   409 already_member — sign in instead
 */
const registerSchema = z.object({
  email: z.string().trim().email(),
  otp: z.string().trim().min(1).max(12),
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(1).max(40),
})

const app = new Hono().post('/members/register', zValidator('json', registerSchema), async c => {
  const body = c.req.valid('json')
  const { token } = await registerMember({
    tenantId: tenantId(c),
    email: body.email,
    otp: body.otp,
    firstName: body.first_name,
    lastName: body.last_name,
    phone: body.phone,
    headers: c.req.raw.headers,
  })
  c.header('set-auth-token', token)
  return c.json({ token })
})

export default app
