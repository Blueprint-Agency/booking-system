import { and, eq, exists, isNull, or, gt, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import { locations } from '../../db/schema/catalog'
import { classes, workshops, workshopDays, ptSessions } from '../../db/schema/schedule'
import { clientPackages } from '../../db/schema/packages'
import { now as clockNow } from '../../lib/clock'
import { countLiveUnlimitedAtLocation } from '../packages/purchase'
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
  const now = clockNow()

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

  // A workshop has no end of its own: it is upcoming or ongoing while any of
  // its days has yet to end.
  const activeWorkshops = await db
    .select({ id: workshops.id })
    .from(workshops)
    .where(
      and(
        eq(workshops.tenantId, tenantId),
        eq(workshops.locationId, id),
        eq(workshops.lifecycle, 'active'),
        exists(
          db
            .select({ id: workshopDays.id })
            .from(workshopDays)
            .where(
              and(
                eq(workshopDays.tenantId, tenantId),
                eq(workshopDays.workshopId, workshops.id),
                gt(workshopDays.endsAt, now),
              ),
            ),
        ),
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
 * How many live Unlimited Plans call this Location home — what archiving it
 * would strand. Another tenant's Location is `location_not_found`, like every
 * other read of one.
 */
export async function liveUnlimitedCount(tenantId: string, id: string): Promise<number> {
  await getLocation(tenantId, id)
  return countLiveUnlimitedAtLocation(tenantId, id, clockNow())
}

/**
 * Soft-delete: row must be currently archived AND not already deleted.
 * Sets deleted_at = now(). The row stays in DB so historical references
 * (audit trail, FKs) keep resolving.
 *
 * Refused while any Unlimited Plan, live or ended, calls it home
 * (spec-pre-launch-batch §1, §7): the plan's Location is a fact of what the
 * member bought, and a deleted one would leave it pointing at nothing. The
 * foreign key refuses the hard delete; this refuses the soft one.
 */
export async function softDeleteLocation(tenantId: string, id: string): Promise<void> {
  const existing = await getLocation(tenantId, id)
  if (existing.archivedAt === null) {
    throw new BadRequestError('location_not_archived')
  }
  const homePlans = await db
    .select({ id: clientPackages.id })
    .from(clientPackages)
    .where(and(eq(clientPackages.tenantId, tenantId), eq(clientPackages.locationId, id)))
  if (homePlans.length) {
    throw new ConflictError('location_in_use', { client_package_ids: homePlans.map(p => p.id) })
  }
  await db
    .update(locations)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, id)))
}

// re-exports for tests / debugging
export const _internal = { or, inArray }
