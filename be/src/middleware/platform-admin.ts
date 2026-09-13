import type { Context, MiddlewareHandler } from 'hono'
import { getClerkPlatformApp, isPlatformAppConfigured, verifyPlatformToken } from '../lib/clerk'
import { isPoolSessionToken, readPoolSession } from '../services/auth/better-auth'
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
 * The allowlist, read once at boot.
 *
 * `PLATFORM_ADMIN_EMAILS` alone — a Tenant's own `SUPERADMIN_EMAIL` is **not**
 * folded in. It used to be, as a bootstrap convenience so that an environment
 * setting nothing new still had one platform admin rather than none. That
 * convenience was the escalation this module's own docstring warns about: it
 * made the first studio's superadmin able to create, list and suspend every
 * other studio on the platform. The platform operator is a level above any
 * studio, so it is named explicitly or not at all.
 *
 * Empty is allowed and means a super portal nobody can reach. That is the safe
 * failure for a missing environment variable — refusing everyone is recoverable,
 * admitting a studio's superadmin to the whole platform is not — and it is
 * announced at boot rather than discovered at the door.
 */
const PLATFORM_ADMINS = parsePlatformAdmins(env.PLATFORM_ADMIN_EMAILS)

if (PLATFORM_ADMINS.length === 0) {
  logger.warn(
    'PLATFORM_ADMIN_EMAILS is unset — the super portal has no administrators and will refuse everyone.',
  )
}

// Announced at boot rather than discovered in a browser. Without its own Clerk
// application the super portal shares the staff app's `__client` cookie, so
// `admin.portal.…` and `{slug}.portal.…` are one signed-in person and cannot be
// two — the allowlist still refuses the wrong account at the API, but the two
// hostnames cannot hold separate sessions in one browser.
if (!isPlatformAppConfigured()) {
  logger.warn(
    'CLERK_PLATFORM_SECRET_KEY is unset — the super portal shares the STAFF Clerk app, so it shares one browser session with every studio portal.',
  )
}

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

  const user = await getClerkPlatformApp().users.getUser(clerkUserId)
  const primary =
    user.emailAddresses.find(address => address.id === user.primaryEmailAddressId) ?? null
  const email = primary?.emailAddress ?? null
  if (email) emailCache.set(clerkUserId, { at: Date.now(), email })
  return email
}

/**
 * Who is behind this bearer token: a Better Auth `platform` session, or a Clerk
 * super portal JWT. Null for anything else — including a studio pool's session,
 * which is a row the platform pool has never seen, and a studio session never
 * reaches the allowlist at all.
 */
async function callerOf(
  c: Context,
  token: string,
): Promise<{ sub: string; email: string | null } | null> {
  if (isPoolSessionToken(token)) {
    const session = await readPoolSession('platform', token)
    return session ? { sub: session.userId, email: session.email } : null
  }

  let sub: string
  try {
    ;({ sub } = await verifyPlatformToken(token))
  } catch {
    return null
  }
  try {
    return { sub, email: await primaryEmail(sub) }
  } catch (err) {
    // A Clerk outage must not become an open door. Refuse, loudly.
    logger.error({ err, clerkUserId: sub }, 'platform-admin: could not read the caller’s email')
    captureException(err, { scope: 'platform-admin-gate' })
    return null
  }
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

  const caller = await callerOf(c, token)
  if (!caller) return c.json({ error: 'not_found' }, 404)
  const { email, sub } = caller

  if (!isPlatformAdmin(email, PLATFORM_ADMINS)) {
    logger.warn({ userId: sub, path: c.req.path }, 'platform-admin: refused')
    return c.json({ error: 'not_found' }, 404)
  }

  c.set('platformAdminEmail', email!.trim().toLowerCase())
  await next()
}
