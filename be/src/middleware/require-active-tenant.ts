import type { MiddlewareHandler } from 'hono'
import { AUTH_BASE_PATH } from '../services/auth/better-auth'
import { effectiveStatus } from '../services/tenants/term-dates'
import { loadTenantById } from '../services/tenants/tenants'
import { tenantId } from './tenant'
import { ERROR_CODES } from '../shared/error-codes'
import { logger } from '../shared/logger'

/**
 * What suspending a studio actually does.
 *
 * `resolveTenantBySlug` deliberately still resolves a suspended tenant — the
 * frontends need to know the studio exists so they can render a "paused" page
 * rather than a 404, and a suspension that looked like a deletion would take a
 * studio's own branding off its own domain. So the refusal happens here instead,
 * on the paths `app.ts` mounts it on.
 *
 * Not the platform routes. The super portal is how a suspension is lifted; a
 * gate that also fenced it would make suspension one-way.
 *
 * Data is untouched. This refuses requests, and nothing else — the whole point
 * of suspending rather than archiving is that a studio can come back.
 */
export const requireActiveTenant: MiddlewareHandler = async (c, next) => {
  const id = tenantId(c)
  const tenant = await loadTenantById(id)

  // Unreachable in practice — resolution already found the row — but a missing
  // tenant here means the request has no honest tenant at all, and proceeding
  // would be worse than refusing.
  if (!tenant) return c.json({ error: ERROR_CODES.not_found }, 404)

  // Effective, not stored: a studio whose Term has ended is suspended from that
  // moment, whether or not the sweep has written it down yet (services/tenants/term.ts).
  const status = effectiveStatus(tenant)
  if (status !== 'active') {
    logger.info(
      { tenantId: id, slug: tenant.slug, status, path: c.req.path },
      'tenant: refused a request to a studio that is not active',
    )
    return c.json({ error: ERROR_CODES.tenant_suspended, status }, 403)
  }

  await next()
}

/**
 * What a suspended studio still answers on its public routes and its member
 * sign-in: the slug lookup, which is how the member app learns to show its
 * paused page and which runs in no Tenant context; the maintenance re-check,
 * which asks about the platform, not the studio; the staff steps, so the
 * studio's staff still sign in and reach the portal's own closed-studio page;
 * and the member reset-link redirect, opened from an inbox with no Tenant.
 */
const OPEN_WHILE_SUSPENDED = [
  '/api/v1/public/tenants/by-slug/',
  '/api/v1/public/maintenance',
  '/api/v1/public/staff/',
  '/api/v1/public/staff-invitation',
  '/api/v1/public/staff-email-change',
  `${AUTH_BASE_PATH.client}/reset-password/`,
]

/** So nobody signs up, is mailed a code or reads a timetable they cannot book. */
export const requireActiveTenantForMembers: MiddlewareHandler = (c, next) =>
  OPEN_WHILE_SUSPENDED.some(prefix => c.req.path.startsWith(prefix)) ? next() : requireActiveTenant(c, next)
