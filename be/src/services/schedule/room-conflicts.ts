import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { rooms } from '../../db/schema/catalog'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { findOccupancyConflicts, type EventRef } from './occupancy'

/**
 * Verify the room exists, is active, and belongs to `locationId`.
 * Throws NotFoundError / BadRequestError otherwise.
 */
export async function assertRoomInLocation(roomId: string, locationId: string): Promise<void> {
  const [room] = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.id, roomId), isNull(rooms.deletedAt)))
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

/**
 * Hard-block clash check: a physical room hosts one session at a time, across
 * classes, workshop days, PT sessions and corporate sessions. See
 * ./occupancy.ts for the rule; this only turns "occupied" into the
 * `room_clash` error the portal already knows.
 * Pass `exclude` when rescheduling so a row doesn't clash with itself.
 */
export async function assertRoomAvailable(
  roomId: string,
  startsAt: Date,
  endsAt: Date,
  exclude?: EventRef,
): Promise<void> {
  const conflicts = await findOccupancyConflicts(
    { kind: 'room', id: roomId },
    { startsAt, endsAt },
    exclude,
  )
  if (conflicts.length) throw new ConflictError('room_clash', { conflicts })
}
