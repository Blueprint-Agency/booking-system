import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { originAllowed } from '../../lib/allowed-origins'
import { platformSignInStep } from '../../services/auth/platform-first-sign-in'

/** The path `index.ts` lets through its gate: nobody is signed in yet. */
export const SIGN_IN_STEP_PATH = '/sign-in/step'

/**
 * The super portal's email-first sign-in step (`services/auth/platform-first-sign-in.ts`).
 * The browser's `Origin` is where a set-password link lands, so it has to be one
 * of ours.
 */
const app = new Hono().post(
  SIGN_IN_STEP_PATH,
  zValidator('json', z.object({ email: z.string().email() })),
  async c => {
    const origin = c.req.header('origin')
    if (!origin || !originAllowed(origin)) return c.json({ error: 'origin_not_allowed' }, 400)
    const result = await platformSignInStep({ email: c.req.valid('json').email, origin, from: c.req.raw.headers })
    return c.json(result)
  },
)

export default app
