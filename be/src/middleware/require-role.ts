import type { MiddlewareHandler } from 'hono'
import type { staffUsers } from '../db/schema/identity'
import { ERROR_CODES } from '../shared/error-codes'

type StaffRole = (typeof staffUsers.$inferSelect)['role']

export function requireRole(...roles: StaffRole[]): MiddlewareHandler {
  return async (c, next) => {
    const row = c.get('staffRow')
    if (!row) return c.json({ error: ERROR_CODES.unauthenticated }, 401)
    if (!roles.includes(row.role)) {
      return c.json({ error: ERROR_CODES.forbidden_role, required: roles, actual: row.role }, 403)
    }
    await next()
  }
}
