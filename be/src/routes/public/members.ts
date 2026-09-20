import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { tenantId } from '../../middleware/tenant'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../../services/auth/auth-users'
import { nextSignInStep, requestMemberPasswordLink, setPasswordFromLink } from '../../services/auth/member-passwords'
import { registerMember } from '../../services/clients/register'

/**
 * Member self-registration and the member sign-in steps that are not Better
 * Auth's own endpoints, on the studio's own member app (#117, #173).
 *
 * POST /api/v1/public/members/register { email, otp, first_name, last_name, phone, password }
 *   → { token }
 *
 *   The page first asks the client pool for a code
 *   (`/api/v1/auth/client/email-otp/send-verification-otp`, type `sign-in`),
 *   then sends it here with the details. The answer is a signed-in session at
 *   this studio — the same bearer token a sign-in returns, also in
 *   `set-auth-token`.
 *
 *   400 invalid_otp | otp_expired — nothing written but the attempt
 *   403 too_many_attempts
 *   409 already_member — sign in instead
 *
 * POST /api/v1/public/members/sign-in-step { email } → { next: 'password' | 'link_sent' }
 *
 *   The email step of the sign-in form. `password`: ask for it and sign in at
 *   `/api/v1/auth/client/sign-in/email`. `link_sent`: show "check your email" —
 *   a set-password link went out if the address is a member here, and nothing
 *   did if it is not; the answer is the same.
 *
 * POST /api/v1/public/members/password-link { email } → { next: 'link_sent' }
 *
 *   "Forgot password": the same link, whether or not a password exists.
 *
 * POST /api/v1/public/members/set-password { token, password } → { token }
 *
 *   The page the link lands on sends the token from its query here with the
 *   new password; the answer is a signed-in session at this studio.
 *
 *   400 invalid_token (used, expired, or not a member of this studio's) |
 *       password_too_short | password_too_long
 *   403 client_blocked
 *
 * The link steps are limited per address and per email: 429 too_many_requests.
 */
const password = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH)

const registerSchema = z.object({
  email: z.string().trim().email(),
  otp: z.string().trim().min(1).max(12),
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(1).max(40),
  password,
})

const emailSchema = z.object({ email: z.string().trim().email() })

// Length is Better Auth's to judge here, so its refusal names the reason.
const setPasswordSchema = z.object({ token: z.string().min(1).max(200), password: z.string().min(1).max(1000) })

const app = new Hono()
  .post('/members/register', zValidator('json', registerSchema), async c => {
    const body = c.req.valid('json')
    const { token } = await registerMember({
      tenantId: tenantId(c),
      email: body.email,
      otp: body.otp,
      firstName: body.first_name,
      lastName: body.last_name,
      phone: body.phone,
      password: body.password,
      headers: c.req.raw.headers,
    })
    c.header('set-auth-token', token)
    return c.json({ token })
  })
  .post('/members/sign-in-step', zValidator('json', emailSchema), async c => {
    const { email } = c.req.valid('json')
    return c.json(await nextSignInStep({ tenantId: tenantId(c), email, from: c.req.raw.headers }))
  })
  .post('/members/password-link', zValidator('json', emailSchema), async c => {
    const { email } = c.req.valid('json')
    return c.json(await requestMemberPasswordLink({ tenantId: tenantId(c), email, from: c.req.raw.headers }))
  })
  .post('/members/set-password', zValidator('json', setPasswordSchema), async c => {
    const body = c.req.valid('json')
    const { token } = await setPasswordFromLink({
      tenantId: tenantId(c),
      token: body.token,
      password: body.password,
      from: c.req.raw.headers,
    })
    c.header('set-auth-token', token)
    return c.json({ token })
  })

export default app
