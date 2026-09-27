import { Hono } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { locations } from '../../db/schema/catalog'
import { tenantId } from '../../middleware/tenant'

/**
 * GET /api/v1/portal/auth/me
 *
 * Returns the staff_users row the session authenticated, plus the denormalised
 * studio's active `locations`, plus `permissions` — the Instructor Permissions
 * the caller holds, as `staffAuth` resolved them on this request: the granted
 * keys for an Instructor, all three for an Admin, so the portal has one shape
 * to reason about (be/docs/adr/0012). Auth (staffAuth + requireActiveStaff) is
 * applied by the parent router (routes/portal/index.ts).
 */
const app = new Hono().get('/me', async c => {
  const row = c.get('staffRow')

  // Every staff member sees all of THIS studio's active locations — never every
  // studio on the platform. This response is what the portal renders its
  // location switcher from.
  const activeLocations = await db
    .select()
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId(c)), isNull(locations.deletedAt)))

  return c.json({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    permissions: [...c.get('staffPermissions')],
    locations: activeLocations
      .filter(l => l.archivedAt === null)
      .map(l => ({
        id: l.id,
        name: l.name,
        address: l.address,
      })),
  })
})

export default app
