import type { MiddlewareHandler } from 'hono'
import { ERROR_CODES } from '../shared/error-codes'

/**
 * Rejects when the loaded staff row is not status='active' (i.e. pending or
 * archived). staffAuth must run first to populate `staffRow`.
 */
export const requireActiveStaff: MiddlewareHandler = async (c, next) => {
  const row = c.get('staffRow')
  if (!row) return c.json({ error: ERROR_CODES.unauthenticated }, 401)
  if (row.status !== 'active') {
    return c.json({ error: ERROR_CODES.staff_inactive, status: row.status }, 403)
  }
  await next()
}
