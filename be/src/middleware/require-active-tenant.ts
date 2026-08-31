import type { MiddlewareHandler } from 'hono'
import { loadTenantById } from '../services/tenants/tenants'
import { tenantId } from './tenant'
import { logger } from '../shared/logger'

/**
 * What suspending a studio actually does.
 *
 * `resolveTenantBySlug` deliberately still resolves a suspended tenant — the
 * frontends need to know the studio exists so they can render a "paused" page
 * rather than a 404, and a suspension that looked like a deletion would take a
 * studio's own branding off its own domain. So the refusal happens here instead,
 * on the routes that *do* something: every member call under `/api/v1/me` and
 * every staff call under `/api/v1/portal`.
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
  if (!tenant) return c.json({ error: 'not_found' }, 404)

  if (tenant.status !== 'active') {
    logger.info(
      { tenantId: id, slug: tenant.slug, status: tenant.status, path: c.req.path },
      'tenant: refused a request to a studio that is not active',
    )
    return c.json({ error: 'tenant_suspended', status: tenant.status }, 403)
  }

  await next()
}
