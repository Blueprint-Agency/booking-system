import type { MiddlewareHandler } from 'hono'

/**
 * Allows GET / HEAD for `admin` role; any mutating method is rejected with 403.
 * Superadmin (and any other allowed role) passes through untouched.
 *
 * Mount AFTER `requireRole('superadmin', 'admin')` — this middleware assumes
 * `staffRow` is present.
 */
export const adminReadOnly: MiddlewareHandler = async (c, next) => {
  const row = c.get('staffRow')
  if (row?.role === 'admin') {
    const m = c.req.method
    if (m !== 'GET' && m !== 'HEAD') {
      return c.json(
        { error: 'forbidden_role', required: ['superadmin'], actual: row.role },
        403,
      )
    }
  }
  await next()
}
