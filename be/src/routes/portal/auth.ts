import { Hono } from 'hono'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { locations } from '../../db/schema/catalog'
import { isSeededSuperadminEmail } from '../../services/auth/staff-archive'
import { tenantId } from '../../middleware/tenant'

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
    // "All active locations" means all of THIS studio's — a superadmin's
    // implicit grant has never meant every studio on the platform, and this
    // response is what the portal renders its location switcher from.
    activeLocations = await db
      .select()
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId(c)), isNull(locations.deletedAt)))
  } else {
    activeLocations = await db
      .select()
      .from(locations)
      .where(
        and(
          eq(locations.tenantId, tenantId(c)),
          inArray(locations.id, granted),
          isNull(locations.deletedAt),
        ),
      )
  }

  return c.json({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    is_seeded_superadmin:
      row.role === 'superadmin' && isSeededSuperadminEmail(row.email),
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
