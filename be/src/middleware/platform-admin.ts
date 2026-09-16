import type { MiddlewareHandler } from 'hono'
import { readPoolSession } from '../services/auth/better-auth'
import { env } from '../env'
import { isPlatformAdmin, parsePlatformAdmins } from '../services/tenants/platform-admin'
import { logger } from '../shared/logger'

declare module 'hono' {
  interface ContextVariableMap {
    platformAdminEmail: string
  }
}

/**
 * The allowlist, read once at boot.
 *
 * `PLATFORM_ADMIN_EMAILS` alone — no studio's staff account is folded in. One
 * used to be, as a bootstrap convenience so that an environment setting nothing
 * new still had one platform admin rather than none. That convenience was the
 * escalation this module's own docstring warns about: it made one studio's
 * staff able to create, list and suspend every other studio on the platform.
 * The platform operator is a level above any
 * studio, so it is named explicitly or not at all.
 *
 * Empty is allowed and means a super portal nobody can reach. That is the safe
 * failure for a missing environment variable — refusing everyone is recoverable,
 * admitting a studio's admin to the whole platform is not — and it is
 * announced at boot rather than discovered at the door.
 */
const PLATFORM_ADMINS = parsePlatformAdmins(env.PLATFORM_ADMIN_EMAILS)

if (PLATFORM_ADMINS.length === 0) {
  logger.warn(
    'PLATFORM_ADMIN_EMAILS is unset — the super portal has no administrators and will refuse everyone.',
  )
}

/**
 * The gate on the super portal: two locks, in order (#116).
 *
 *  1. **A `platform` pool session.** The super portal signs in through its own
 *     Better Auth instance, whose users are rows no studio can write. A studio
 *     session — staff or member, admin or not — is a row this pool has
 *     never seen, so it never reaches the allowlist at all.
 *  2. **The session's email on `PLATFORM_ADMIN_EMAILS`.** Read from the session
 *     on every request and remembered nowhere, so an address taken off the list
 *     is refused on its next request.
 *
 * No `staff_users` row is read and no tenant is resolved. Being an admin
 * of a studio is a role inside that studio; it says nothing about the platform.
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

  const session = await readPoolSession('platform', token)
  if (!session) return c.json({ error: 'not_found' }, 404)

  if (!isPlatformAdmin(session.email, PLATFORM_ADMINS)) {
    logger.warn({ userId: session.userId, path: c.req.path }, 'platform-admin: refused')
    return c.json({ error: 'not_found' }, 404)
  }

  c.set('platformAdminEmail', session.email.trim().toLowerCase())
  await next()
}
