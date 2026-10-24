import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { rooms } from '../../db/schema/catalog'
import { BadRequestError, NotFoundError } from '../../shared/errors'

/**
 * Verify the room exists, is active, belongs to this tenant, and sits in
 * `locationId`. Throws NotFoundError / BadRequestError otherwise.
 *
 * Another tenant's room is `room_not_found` — this is the gate that stops a
 * session being scheduled into somebody else's premises.
 */
export async function assertRoomInLocation(
  tenantId: string,
  roomId: string,
  locationId: string,
): Promise<void> {
  const [room] = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.tenantId, tenantId), eq(rooms.id, roomId), isNull(rooms.deletedAt)))
    .limit(1)
  if (!room) throw new NotFoundError('room_not_found')
  if (room.archivedAt) throw new BadRequestError('room_archived', { room_id: roomId })
  if (room.locationId !== locationId) {
    throw new BadRequestError('room_location_mismatch', {
      room_id: roomId,
      room_location_id: room.locationId,
      location_id: locationId,
    })
  }
}
