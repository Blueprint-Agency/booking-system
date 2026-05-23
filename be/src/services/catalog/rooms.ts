import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { locations, rooms } from '../../db/schema/catalog'
import { classes, workshopDays, workshops, ptSessions } from '../../db/schema/schedule'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'

export type RoomRow = typeof rooms.$inferSelect

export async function listRooms(opts: {
  locationId?: string
  includeArchived: boolean
}): Promise<RoomRow[]> {
  const conds = []
  if (opts.locationId) conds.push(eq(rooms.locationId, opts.locationId))
  if (!opts.includeArchived) conds.push(isNull(rooms.archivedAt))
  if (conds.length === 0) return db.select().from(rooms)
  return db
    .select()
    .from(rooms)
    .where(conds.length === 1 ? conds[0] : and(...conds))
}

export async function getRoom(id: string): Promise<RoomRow> {
  const [row] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1)
  if (!row) throw new NotFoundError('room_not_found')
  return row
}

async function assertLocationActive(locationId: string): Promise<void> {
  const [loc] = await db.select().from(locations).where(eq(locations.id, locationId)).limit(1)
  if (!loc) throw new NotFoundError('location_not_found')
  if (loc.archivedAt) throw new BadRequestError('location_archived', { location_id: locationId })
}

export async function createRoom(input: {
  location_id: string
  name: string
  capacity: number
}): Promise<RoomRow> {
  await assertLocationActive(input.location_id)
  const [row] = await db
    .insert(rooms)
    .values({
      locationId: input.location_id,
      name: input.name,
      capacity: input.capacity,
    })
    .returning()
  return row!
}

export async function updateRoom(
  id: string,
  patch: { name?: string; capacity?: number },
): Promise<RoomRow> {
  await getRoom(id) // 404 if missing
  const setPatch: Record<string, unknown> = {}
  if (patch.name !== undefined) setPatch.name = patch.name
  if (patch.capacity !== undefined) setPatch.capacity = patch.capacity
  const [row] = await db.update(rooms).set(setPatch).where(eq(rooms.id, id)).returning()
  return row!
}

// A room can't be archived while a future, active session still references it.
async function gatherLinkedDataBlockers(roomId: string) {
  const now = new Date()

  const futureClasses = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.roomId, roomId), eq(classes.lifecycle, 'active'), gt(classes.endsAt, now)))

  const futureWorkshopDays = await db
    .select({ id: workshopDays.id })
    .from(workshopDays)
    .innerJoin(workshops, eq(workshops.id, workshopDays.workshopId))
    .where(
      and(
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
        eq(ptSessions.roomId, roomId),
        eq(ptSessions.lifecycle, 'active'),
        gt(ptSessions.endsAt, now),
      ),
    )

  return { futureClasses, futureWorkshopDays, futurePtSessions }
}

export async function archiveRoom(id: string): Promise<RoomRow> {
  await getRoom(id)
  const { futureClasses, futureWorkshopDays, futurePtSessions } =
    await gatherLinkedDataBlockers(id)
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
    .where(eq(rooms.id, id))
    .returning()
  return row!
}

export async function unarchiveRoom(id: string): Promise<RoomRow> {
  await getRoom(id)
  const [row] = await db.update(rooms).set({ archivedAt: null }).where(eq(rooms.id, id)).returning()
  return row!
}
