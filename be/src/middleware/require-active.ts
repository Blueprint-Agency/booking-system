import type { MiddlewareHandler } from 'hono'

/**
 * Rejects when the loaded staff row is not status='active' (i.e. pending or
 * archived). clerkStaffAuth must run first to populate `staffRow`.
 */
export const requireActiveStaff: MiddlewareHandler = async (c, next) => {
  const row = c.get('staffRow')
  if (!row) return c.json({ error: 'unauthenticated' }, 401)
  if (row.status !== 'active') {
    return c.json({ error: 'staff_inactive', status: row.status }, 403)
  }
  await next()
}
