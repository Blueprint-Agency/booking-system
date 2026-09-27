import type { MiddlewareHandler } from 'hono'
import type { InstructorPermission } from '../db/enums'
import { ERROR_CODES } from '../shared/error-codes'

/**
 * Refuse a request whose caller lacks an **Instructor Permission**
 * (be/docs/adr/0012). Sits beside `requireRole` in the instructor subtree,
 * applied per route, after the role gate: a non-staff caller sees the role
 * refusals unchanged, and an Instructor without the switch sees
 *
 *   403 forbidden_permission { required: '<key>' }
 *
 * The set is resolved by `staffAuth` on every request — an Admin to everything,
 * an Instructor to what their profile row grants — so a change an Admin makes
 * is felt on the Instructor's next request, with no new sign-in. It runs before
 * any ownership check in the service, so an Instructor with the switch off on
 * someone else's class is told about the permission, not the ownership.
 */
export function requirePermission(key: InstructorPermission): MiddlewareHandler {
  return async (c, next) => {
    const permissions = c.get('staffPermissions')
    if (!permissions) return c.json({ error: ERROR_CODES.unauthenticated }, 401)
    if (!permissions.has(key)) {
      return c.json({ error: ERROR_CODES.forbidden_permission, required: key }, 403)
    }
    await next()
  }
}
