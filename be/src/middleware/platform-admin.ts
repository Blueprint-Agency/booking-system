import type { MiddlewareHandler } from 'hono'
import { clerkStaffApp, verifyStaffToken } from '../lib/clerk'
import { env } from '../env'
import { isPlatformAdmin, parsePlatformAdmins } from '../services/tenants/platform-admin'
import { logger } from '../shared/logger'
import { captureException } from '../instrument'

declare module 'hono' {
  interface ContextVariableMap {
    platformAdminEmail: string
  }
}

/**
 * The allowlist, read once at boot. `SUPERADMIN_EMAIL` is always in it, so an
 * environment that sets nothing new still has exactly one platform admin rather
 * than none — a super portal nobody can reach is not a safe default, it is an
 * outage waiting for the first tenant.
 */
const PLATFORM_ADMINS = parsePlatformAdmins(env.PLATFORM_ADMIN_EMAILS, env.SUPERADMIN_EMAIL)

/**
 * Short memo of clerk user id → primary email. The gate runs on every super
 * portal request and the answer changes about never; without it every list
 * refresh is a round trip to Clerk before it is a round trip to us.
 *
 * Positive-only and short, for the same reason as the tenant memo: an unknown
 * id must not be able to pin arbitrary strings in memory, and an address removed
 * from a Clerk account must stop working promptly.
 */
const EMAIL_TTL_MS = 60_000
const emailCache = new Map<string, { at: number; email: string | null }>()

async function primaryEmail(clerkUserId: string): Promise<string | null> {
  const cached = emailCache.get(clerkUserId)
  if (cached && Date.now() - cached.at < EMAIL_TTL_MS) return cached.email
  if (cached) emailCache.delete(clerkUserId)

  const user = await clerkStaffApp.users.getUser(clerkUserId)
  const primary =
    user.emailAddresses.find(address => address.id === user.primaryEmailAddressId) ?? null
  const email = primary?.emailAddress ?? null
  if (email) emailCache.set(clerkUserId, { at: Date.now(), email })
  return email
}

/**
 * The gate on the super portal.
 *
 * A valid Clerk staff token gets you as far as this line and no further: what
 * decides the outcome is whether the *account behind it* is on the platform
 * allowlist. That is the whole difference between this and `clerkStaffAuth` —
 * no `staff_users` row is read, no tenant is resolved, and a studio's own
 * superadmin is refused here exactly as flatly as a stranger is. Being the
 * superadmin of a studio is a role inside that studio; it says nothing about
 * the platform.
 *
 * The refusal body is `not_found`, not `forbidden`: a signed-in staff member
 * poking at `/api/v1/platform/*` should learn nothing about whether the super
 * portal exists.
 */
export const requirePlatformAdmin: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization')
  if (!header?.startsWith('Bearer ')) return c.json({ error: 'not_found' }, 404)
  const token = header.slice(7).trim()
  if (!token) return c.json({ error: 'not_found' }, 404)

  let sub: string
  try {
    ;({ sub } = await verifyStaffToken(token))
  } catch {
    return c.json({ error: 'not_found' }, 404)
  }

  let email: string | null
  try {
    email = await primaryEmail(sub)
  } catch (err) {
    // A Clerk outage must not become an open door. Refuse, loudly.
    logger.error({ err, clerkUserId: sub }, 'platform-admin: could not read the caller’s email')
    captureException(err, { scope: 'platform-admin-gate' })
    return c.json({ error: 'not_found' }, 404)
  }

  if (!isPlatformAdmin(email, PLATFORM_ADMINS)) {
    logger.warn({ clerkUserId: sub, path: c.req.path }, 'platform-admin: refused')
    return c.json({ error: 'not_found' }, 404)
  }

  c.set('platformAdminEmail', email!.trim().toLowerCase())
  await next()
}
