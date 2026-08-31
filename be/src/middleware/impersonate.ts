import type { MiddlewareHandler } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { staffUsers } from '../db/schema/identity'
import { tenantId } from './tenant'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Superadmin impersonation: when a superadmin sends `x-impersonate-staff-id`,
 * the request is treated as if performed by that staff for service-layer
 * decisions, while audit_log records both the actor (superadmin) and impersonatedBy.
 *
 * **The target has to be a colleague.** Impersonation is the one path that hands
 * a caller somebody else's identity, so an unchecked staff id would be a way to
 * act as another studio's admin — the single header that undoes every filter
 * below it. The lookup is scoped to the request's tenant, and a target outside
 * it is refused with the same 403 as a non-superadmin: whether the id exists
 * elsewhere on the platform is not something this answer should reveal.
 */
export const impersonate: MiddlewareHandler = async (c, next) => {
  const row = c.get('staffRow')
  if (!row) return next()

  const target = c.req.header('x-impersonate-staff-id')
  if (!target) return next()

  if (row.role !== 'superadmin') {
    return c.json({ error: 'impersonation_requires_superadmin' }, 403)
  }

  // A header is a string; the column is a uuid. Without this an arbitrary value
  // reaches Postgres as a cast error and a 500.
  if (!UUID.test(target)) {
    return c.json({ error: 'impersonation_requires_superadmin' }, 403)
  }

  const [targetRow] = await db
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(and(eq(staffUsers.tenantId, tenantId(c)), eq(staffUsers.id, target)))
    .limit(1)
  if (!targetRow) {
    return c.json({ error: 'impersonation_requires_superadmin' }, 403)
  }

  c.set('actingAs', target)
  c.set('impersonatedBy', row.id)
  await next()
}
