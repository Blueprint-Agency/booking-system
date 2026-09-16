import { eq } from 'drizzle-orm'
import { db } from '../../db'
import * as schema from '../../db/schema'
import { env } from '../../env'
import { isPlatformAdmin, parsePlatformAdmins } from '../tenants/platform-admin'
import { hasPassword } from './auth-users'
import { mailPlatformSetPasswordLink } from './better-auth'

/**
 * The super portal's sign-in asks for the email first, and decides the next
 * step from it:
 *
 *   - `set_password` — an operator on `PLATFORM_ADMIN_EMAILS` whose seeded
 *     account has no password yet (`db/seed/platform-admin.ts`). The link that
 *     sets one is mailed right away, so there is no password field to fail at
 *     and no "Forgot password" to find.
 *   - `password` — everyone else, including addresses that are not operators at
 *     all, so a stranger learns nothing beyond what the password form says.
 *
 * What it does reveal: that an address is an operator who has not set a
 * password yet. That window closes the moment they set one, and the list is a
 * handful of platform addresses, so the plain flow is worth it.
 *
 * A repeat within `RESEND_COOLDOWN_MS` mails nothing and says how long to wait,
 * so the resend button cannot be turned into a mail flood.
 */

export type FirstSignInStep =
  | { step: 'password' }
  | { step: 'set_password'; sent: boolean; retryAfterSeconds: number }

export const RESEND_COOLDOWN_MS = 60_000

const PLATFORM_ADMINS = parsePlatformAdmins(env.PLATFORM_ADMIN_EMAILS)

/** When each address was last mailed a link. One process serves the API, so memory is enough. */
const lastSent = new Map<string, number>()

export async function platformSignInStep(input: {
  email: string
  origin: string
  from: Headers
  now?: number
}): Promise<FirstSignInStep> {
  const email = input.email.trim().toLowerCase()
  if (!isPlatformAdmin(email, PLATFORM_ADMINS)) return { step: 'password' }

  const [user] = await db
    .select({ id: schema.platformAuthUsers.id })
    .from(schema.platformAuthUsers)
    .where(eq(schema.platformAuthUsers.email, email))
    .limit(1)
  if (!user || (await hasPassword(db, 'platform', user.id))) return { step: 'password' }

  const now = input.now ?? Date.now()
  const waitMs = (lastSent.get(email) ?? -Infinity) + RESEND_COOLDOWN_MS - now
  if (waitMs > 0) return { step: 'set_password', sent: false, retryAfterSeconds: Math.ceil(waitMs / 1000) }

  // Claimed before the await, so two requests racing past the check mail once.
  const previous = lastSent.get(email)
  lastSent.set(email, now)
  try {
    await mailPlatformSetPasswordLink(input.from, email, input.origin)
  } catch (err) {
    if (previous === undefined) lastSent.delete(email)
    else lastSent.set(email, previous)
    throw err
  }
  return { step: 'set_password', sent: true, retryAfterSeconds: RESEND_COOLDOWN_MS / 1000 }
}
