import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { locations, rooms } from '../../db/schema/catalog'
import { classes, workshopDays, workshops, ptSessions } from '../../db/schema/schedule'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'

export type RoomRow = typeof rooms.$inferSelect

export async function listRooms(
  tenantId: string,
  opts: {
    locationId?: string
    includeArchived: boolean
  },
): Promise<RoomRow[]> {
  const conds = [eq(rooms.tenantId, tenantId), isNull(rooms.deletedAt)]
  if (opts.locationId) conds.push(eq(rooms.locationId, opts.locationId))
  if (!opts.includeArchived) conds.push(isNull(rooms.archivedAt))
  return db
    .select()
    .from(rooms)
    .where(and(...conds))
}

export async function getRoom(tenantId: string, id: string): Promise<RoomRow> {
  const [row] = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.tenantId, tenantId), eq(rooms.id, id), isNull(rooms.deletedAt)))
    .limit(1)
  if (!row) throw new NotFoundError('room_not_found')
  return row
}

async function assertLocationActive(tenantId: string, locationId: string): Promise<void> {
  const [loc] = await db
    .select()
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        eq(locations.id, locationId),
        isNull(locations.deletedAt),
      ),
    )
    .limit(1)
  if (!loc) throw new NotFoundError('location_not_found')
  if (loc.archivedAt) throw new BadRequestError('location_archived', { location_id: locationId })
}

export async function createRoom(
  tenantId: string,
  input: {
    location_id: string
    name: string
    capacity: number
  },
): Promise<RoomRow> {
  // Also the cross-tenant gate: a room can only be hung off this tenant's own
  // location, so a borrowed location id is `location_not_found`.
  await assertLocationActive(tenantId, input.location_id)
  const [row] = await db
    .insert(rooms)
    .values({
      tenantId,
      locationId: input.location_id,
      name: input.name,
      capacity: input.capacity,
    })
    .returning()
  return row!
}

export async function updateRoom(
  tenantId: string,
  id: string,
  patch: { name?: string; capacity?: number },
): Promise<RoomRow> {
  await getRoom(tenantId, id) // 404 if missing
  const setPatch: Record<string, unknown> = {}
  if (patch.name !== undefined) setPatch.name = patch.name
  if (patch.capacity !== undefined) setPatch.capacity = patch.capacity
  const [row] = await db
    .update(rooms)
    .set(setPatch)
    .where(and(eq(rooms.tenantId, tenantId), eq(rooms.id, id)))
    .returning()
  return row!
}

// A room can't be archived while a future, active session still references it.
async function gatherLinkedDataBlockers(tenantId: string, roomId: string) {
  const now = new Date()

  const futureClasses = await db
    .select({ id: classes.id })
    .from(classes)
    .where(
      and(
        eq(classes.tenantId, tenantId),
        eq(classes.roomId, roomId),
        eq(classes.lifecycle, 'active'),
        gt(classes.endsAt, now),
      ),
    )

  const futureWorkshopDays = await db
    .select({ id: workshopDays.id })
    .from(workshopDays)
    .innerJoin(workshops, eq(workshops.id, workshopDays.workshopId))
    .where(
      and(
        eq(workshopDays.tenantId, tenantId),
        eq(workshopDays.roomId, roomId),
        eq(workshops.lifecycle, 'active'),
        gt(workshopDays.endsAt, now),
      ),
    )

  const futurePtSessions = await db
    .select({ id: ptSessions.id })
    .from(ptSessions)
    .where(
      and(
        eq(ptSessions.tenantId, tenantId),
        eq(ptSessions.roomId, roomId),
        eq(ptSessions.lifecycle, 'active'),
        gt(ptSessions.endsAt, now),
      ),
    )

  return { futureClasses, futureWorkshopDays, futurePtSessions }
}

export async function archiveRoom(tenantId: string, id: string): Promise<RoomRow> {
  const existing = await getRoom(tenantId, id)
  if (existing.deletedAt) throw new NotFoundError('room_not_found')
  const { futureClasses, futureWorkshopDays, futurePtSessions } = await gatherLinkedDataBlockers(
    tenantId,
    id,
  )
  if (futureClasses.length || futureWorkshopDays.length || futurePtSessions.length) {
    throw new ConflictError('room_in_use', {
      class_ids: futureClasses.map(r => r.id),
      workshop_day_ids: futureWorkshopDays.map(r => r.id),
      pt_session_ids: futurePtSessions.map(r => r.id),
    })
  }
  const [row] = await db
    .update(rooms)
    .set({ archivedAt: new Date() })
    .where(and(eq(rooms.tenantId, tenantId), eq(rooms.id, id)))
    .returning()
  return row!
}

export async function unarchiveRoom(tenantId: string, id: string): Promise<RoomRow> {
  const existing = await getRoom(tenantId, id)
  if (existing.archivedAt === null) {
    throw new BadRequestError('room_not_archived')
  }
  const [row] = await db
    .update(rooms)
    .set({ archivedAt: null })
    .where(and(eq(rooms.tenantId, tenantId), eq(rooms.id, id)))
    .returning()
  return row!
}

/**
 * Soft-delete a room. Must already be archived and not yet deleted.
 */
export async function softDeleteRoom(tenantId: string, id: string): Promise<void> {
  const existing = await getRoom(tenantId, id)
  if (existing.archivedAt === null) {
    throw new BadRequestError('room_not_archived')
  }
  await db
    .update(rooms)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(rooms.tenantId, tenantId), eq(rooms.id, id)))
}
