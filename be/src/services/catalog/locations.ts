import { and, eq, isNull, or, gt, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import { locations } from '../../db/schema/catalog'
import { classes, workshops, ptSessions } from '../../db/schema/schedule'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'

export type LocationRow = typeof locations.$inferSelect

export async function listLocations(
  tenantId: string,
  opts: { includeArchived: boolean },
): Promise<LocationRow[]> {
  if (opts.includeArchived) {
    return db
      .select()
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), isNull(locations.deletedAt)))
  }
  return db
    .select()
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        isNull(locations.archivedAt),
        isNull(locations.deletedAt),
      ),
    )
}

export async function getLocation(tenantId: string, id: string): Promise<LocationRow> {
  const [row] = await db
    .select()
    .from(locations)
    .where(
      and(eq(locations.tenantId, tenantId), eq(locations.id, id), isNull(locations.deletedAt)),
    )
    .limit(1)
  // Another tenant's location is `location_not_found`, not a 403: the caller
  // must not be able to tell "not yours" from "does not exist".
  if (!row) throw new NotFoundError('location_not_found')
  return row
}

export async function createLocation(
  tenantId: string,
  input: {
    name: string
    address?: string | null
    gmapsUrl?: string | null
    phone?: string | null
  },
): Promise<LocationRow> {
  const [row] = await db
    .insert(locations)
    .values({
      tenantId,
      name: input.name,
      address: input.address ?? null,
      gmapsUrl: input.gmapsUrl ?? null,
      phone: input.phone ?? null,
    })
    .returning()
  return row!
}

export async function updateLocation(
  tenantId: string,
  id: string,
  patch: Partial<Pick<LocationRow, 'name' | 'address' | 'gmapsUrl' | 'phone'>>,
): Promise<LocationRow> {
  await getLocation(tenantId, id) // 404 if missing or another tenant's
  const [row] = await db
    .update(locations)
    .set(patch)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, id)))
    .returning()
  return row!
}

/**
 * Archive a location. Refuses if any active future session references it.
 * Returns the offending IDs grouped by kind so the UI can render a list.
 */
export async function archiveLocation(tenantId: string, id: string): Promise<LocationRow> {
  const existing = await getLocation(tenantId, id)
  if (existing.deletedAt) throw new NotFoundError('location_not_found')
  const now = new Date()

  const activeClasses = await db
    .select({ id: classes.id })
    .from(classes)
    .where(
      and(
        eq(classes.tenantId, tenantId),
        eq(classes.locationId, id),
        eq(classes.lifecycle, 'active'),
        gt(classes.endsAt, now),
      ),
    )

  const activeWorkshops = await db
    .select({ id: workshops.id })
    .from(workshops)
    .where(
      and(
        eq(workshops.tenantId, tenantId),
        eq(workshops.locationId, id),
        eq(workshops.lifecycle, 'active'),
      ),
    )

  const activePtSessions = await db
    .select({ id: ptSessions.id })
    .from(ptSessions)
    .where(
      and(
        eq(ptSessions.tenantId, tenantId),
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
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, id)))
    .returning()
  return row!
}

export async function unarchiveLocation(tenantId: string, id: string): Promise<LocationRow> {
  const existing = await getLocation(tenantId, id)
  if (existing.archivedAt === null) {
    throw new BadRequestError('location_not_archived')
  }
  const [row] = await db
    .update(locations)
    .set({ archivedAt: null })
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, id)))
    .returning()
  return row!
}

/**
 * Soft-delete: row must be currently archived AND not already deleted.
 * Sets deleted_at = now(). The row stays in DB so historical references
 * (audit trail, FKs) keep resolving.
 */
export async function softDeleteLocation(tenantId: string, id: string): Promise<void> {
  const existing = await getLocation(tenantId, id)
  if (existing.archivedAt === null) {
    throw new BadRequestError('location_not_archived')
  }
  await db
    .update(locations)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, id)))
}

// re-exports for tests / debugging
export const _internal = { or, inArray }
