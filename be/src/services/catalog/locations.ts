import { and, eq, isNull, or, gt, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { locations } from '../../db/schema/catalog'
import { classes, workshops, ptSessions } from '../../db/schema/schedule'
import { ConflictError, NotFoundError } from '../../shared/errors'

export type LocationRow = typeof locations.$inferSelect

export async function listLocations(opts: { includeArchived: boolean }): Promise<LocationRow[]> {
  if (opts.includeArchived) return db.select().from(locations)
  return db.select().from(locations).where(isNull(locations.archivedAt))
}

export async function getLocation(id: string): Promise<LocationRow> {
  const [row] = await db.select().from(locations).where(eq(locations.id, id)).limit(1)
  if (!row) throw new NotFoundError('location_not_found')
  return row
}

export async function createLocation(input: {
  name: string
  address?: string | null
  gmapsUrl?: string | null
  phone?: string | null
}): Promise<LocationRow> {
  const [row] = await db
    .insert(locations)
    .values({
      name: input.name,
      address: input.address ?? null,
      gmapsUrl: input.gmapsUrl ?? null,
      phone: input.phone ?? null,
    })
    .returning()
  return row!
}

export async function updateLocation(
  id: string,
  patch: Partial<Pick<LocationRow, 'name' | 'address' | 'gmapsUrl' | 'phone'>>,
): Promise<LocationRow> {
  await getLocation(id) // 404 if missing
  const [row] = await db.update(locations).set(patch).where(eq(locations.id, id)).returning()
  return row!
}

/**
 * Archive a location. Refuses if any active future session references it.
 * Returns the offending IDs grouped by kind so the UI can render a list.
 */
export async function archiveLocation(id: string): Promise<LocationRow> {
  await getLocation(id)
  const now = new Date()

  const activeClasses = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.locationId, id), eq(classes.lifecycle, 'active'), gt(classes.endsAt, now)))

  const activeWorkshops = await db
    .select({ id: workshops.id })
    .from(workshops)
    .where(and(eq(workshops.locationId, id), eq(workshops.lifecycle, 'active')))

  const activePtSessions = await db
    .select({ id: ptSessions.id })
    .from(ptSessions)
    .where(
      and(
        eq(ptSessions.locationId, id),
        eq(ptSessions.lifecycle, 'active'),
        gt(ptSessions.endsAt, now),
      ),
    )

  if (activeClasses.length || activeWorkshops.length || activePtSessions.length) {
    throw new ConflictError('location_in_use', {
      class_ids: activeClasses.map(r => r.id),
      workshop_ids: activeWorkshops.map(r => r.id),
      pt_session_ids: activePtSessions.map(r => r.id),
    })
  }

  const [row] = await db
    .update(locations)
    .set({ archivedAt: now })
    .where(eq(locations.id, id))
    .returning()
  return row!
}

export async function unarchiveLocation(id: string): Promise<LocationRow> {
  await getLocation(id)
  const [row] = await db
    .update(locations)
    .set({ archivedAt: null })
    .where(eq(locations.id, id))
    .returning()
  return row!
}

// re-exports for tests / debugging
export const _internal = { or, inArray }
