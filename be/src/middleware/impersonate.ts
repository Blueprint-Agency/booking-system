import type { MiddlewareHandler } from 'hono'

/**
 * Superadmin impersonation: when a superadmin sends `x-impersonate-staff-id`,
 * the request is treated as if performed by that staff for service-layer
 * decisions, while audit_log records both the actor (superadmin) and impersonatedBy.
 */
export const impersonate: MiddlewareHandler = async (c, next) => {
  const row = c.get('staffRow')
  if (!row) return next()

  const target = c.req.header('x-impersonate-staff-id')
  if (!target) return next()

  if (row.role !== 'superadmin') {
    return c.json({ error: 'impersonation_requires_superadmin' }, 403)
  }

  c.set('actingAs', target)
  c.set('impersonatedBy', row.id)
  await next()
}
