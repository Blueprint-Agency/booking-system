import { and, eq, gt, isNull, lt, ne } from 'drizzle-orm'
import { db } from '../../db'
import { rooms } from '../../db/schema/catalog'
import {
  classes,
  corporateSessions,
  workshopDays,
  workshops,
  ptSessions,
} from '../../db/schema/schedule'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'

export interface RoomConflict {
  kind: 'class' | 'workshop_day' | 'pt_session' | 'corporate_session'
  id: string
  starts_at: string
  ends_at: string
}

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
 * classes, workshop days, and PT sessions. Two ranges overlap when
 * `existing.startsAt < endsAt AND existing.endsAt > startsAt`.
 * Cancelled sessions (and cancelled workshops) are ignored.
 * Pass the matching `exclude*Id` when rescheduling so a row doesn't clash with itself.
 */
export async function assertRoomAvailable(
  roomId: string,
  startsAt: Date,
  endsAt: Date,
  exclude: {
    excludeClassId?: string
    excludeWorkshopDayId?: string
    excludePtSessionId?: string
    excludeCorporateSessionId?: string
  } = {},
): Promise<void> {
  const conflicts: RoomConflict[] = []

  // ---- classes ----
  const classConds = [
    eq(classes.roomId, roomId),
    eq(classes.lifecycle, 'active'),
    lt(classes.startsAt, endsAt),
    gt(classes.endsAt, startsAt),
  ]
  if (exclude.excludeClassId) classConds.push(ne(classes.id, exclude.excludeClassId))
  const classHits = await db
    .select({ id: classes.id, startsAt: classes.startsAt, endsAt: classes.endsAt })
    .from(classes)
    .where(and(...classConds))
  for (const h of classHits) {
    conflicts.push({
      kind: 'class',
      id: h.id,
      starts_at: h.startsAt.toISOString(),
      ends_at: h.endsAt.toISOString(),
    })
  }

  // ---- workshop days (active when parent workshop is active) ----
  const dayConds = [
    eq(workshopDays.roomId, roomId),
    eq(workshops.lifecycle, 'active'),
    lt(workshopDays.startsAt, endsAt),
    gt(workshopDays.endsAt, startsAt),
  ]
  if (exclude.excludeWorkshopDayId) dayConds.push(ne(workshopDays.id, exclude.excludeWorkshopDayId))
  const dayHits = await db
    .select({ id: workshopDays.id, startsAt: workshopDays.startsAt, endsAt: workshopDays.endsAt })
    .from(workshopDays)
    .innerJoin(workshops, eq(workshops.id, workshopDays.workshopId))
    .where(and(...dayConds))
  for (const h of dayHits) {
    conflicts.push({
      kind: 'workshop_day',
      id: h.id,
      starts_at: h.startsAt.toISOString(),
      ends_at: h.endsAt.toISOString(),
    })
  }

  // ---- pt sessions ----
  const ptConds = [
    eq(ptSessions.roomId, roomId),
    eq(ptSessions.lifecycle, 'active'),
    lt(ptSessions.startsAt, endsAt),
    gt(ptSessions.endsAt, startsAt),
  ]
  if (exclude.excludePtSessionId) ptConds.push(ne(ptSessions.id, exclude.excludePtSessionId))
  const ptHits = await db
    .select({ id: ptSessions.id, startsAt: ptSessions.startsAt, endsAt: ptSessions.endsAt })
    .from(ptSessions)
    .where(and(...ptConds))
  for (const h of ptHits) {
    conflicts.push({
      kind: 'pt_session',
      id: h.id,
      starts_at: h.startsAt.toISOString(),
      ends_at: h.endsAt.toISOString(),
    })
  }

  // ---- corporate sessions ----
  const corpConds = [
    eq(corporateSessions.roomId, roomId),
    eq(corporateSessions.lifecycle, 'active'),
    lt(corporateSessions.startsAt, endsAt),
    gt(corporateSessions.endsAt, startsAt),
  ]
  if (exclude.excludeCorporateSessionId) {
    corpConds.push(ne(corporateSessions.id, exclude.excludeCorporateSessionId))
  }
  const corpHits = await db
    .select({
      id: corporateSessions.id,
      startsAt: corporateSessions.startsAt,
      endsAt: corporateSessions.endsAt,
    })
    .from(corporateSessions)
    .where(and(...corpConds))
  for (const h of corpHits) {
    conflicts.push({
      kind: 'corporate_session',
      id: h.id,
      starts_at: h.startsAt.toISOString(),
      ends_at: h.endsAt.toISOString(),
    })
  }

  if (conflicts.length) {
    throw new ConflictError('room_clash', { conflicts })
  }
}
