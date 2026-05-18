import { Hono } from 'hono'
import { inArray } from 'drizzle-orm'
import { db } from '../../db'
import { locations } from '../../db/schema/catalog'

/**
 * GET /api/v1/portal/auth/me
 *
 * Returns the staff_users row Clerk has authenticated, plus the denormalised
 * `locations` they have access to (empty granted_location_ids → all active
 * locations, per §4a). Auth (clerkStaffAuth + requireActiveStaff) is applied
 * by the parent router (routes/portal/index.ts).
 */
const app = new Hono().get('/me', async c => {
  const row = c.get('staffRow')

  const granted = row.grantedLocationIds ?? []
  let activeLocations: Array<typeof locations.$inferSelect> = []

  if (granted.length === 0) {
    // "All active locations" — superadmin or implicit grant.
    activeLocations = await db.select().from(locations)
  } else {
    activeLocations = await db.select().from(locations).where(inArray(locations.id, granted))
  }

  return c.json({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    granted_location_ids: granted,
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
