import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  workshops,
  workshopDays,
  workshopTiers,
  workshopTierDays,
} from '../../db/schema/schedule'
import { bookings } from '../../db/schema/bookings'
import { ConflictError, NotFoundError, BadRequestError } from '../../shared/errors'
import { assertRoomAvailable, assertRoomInLocation } from '../schedule/room-conflicts'

export type WorkshopDayRow = typeof workshopDays.$inferSelect

export interface CreateDayInput {
  ord: number
  roomId: string
  startsAt: Date
  endsAt: Date
  basePriceSgd: string
  capacityOnline: number
  capacityWaitlist?: number
  capacityBuffer?: number
}

async function ensureWorkshop(workshopId: string) {
  const [w] = await db.select().from(workshops).where(eq(workshops.id, workshopId)).limit(1)
  if (!w) throw new NotFoundError('workshop_not_found')
  return w
}

export async function listDays(workshopId: string): Promise<WorkshopDayRow[]> {
  await ensureWorkshop(workshopId)
  return db
    .select()
    .from(workshopDays)
    .where(eq(workshopDays.workshopId, workshopId))
    .orderBy(workshopDays.ord)
}

export async function createDay(workshopId: string, input: CreateDayInput): Promise<WorkshopDayRow> {
  const w = await ensureWorkshop(workshopId)
  if (input.endsAt <= input.startsAt) throw new BadRequestError('ends_at_must_be_after_starts_at')
  await assertRoomInLocation(w.tenantId!, input.roomId, w.locationId)
  await assertRoomAvailable(w.tenantId!, input.roomId, input.startsAt, input.endsAt)
  const [row] = await db
    .insert(workshopDays)
    .values({
      tenantId: w.tenantId,
      workshopId,
      ord: input.ord,
      roomId: input.roomId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      basePriceSgd: input.basePriceSgd,
      capacityOnline: input.capacityOnline,
      capacityWaitlist: input.capacityWaitlist ?? 0,
      capacityBuffer: input.capacityBuffer ?? 0,
    })
    .returning()
  return row!
}

export async function updateDay(
  workshopId: string,
  dayId: string,
  patch: Partial<CreateDayInput>,
): Promise<WorkshopDayRow> {
  await ensureWorkshop(workshopId)
  const [existing] = await db
    .select()
    .from(workshopDays)
    .where(and(eq(workshopDays.id, dayId), eq(workshopDays.workshopId, workshopId)))
    .limit(1)
  if (!existing) throw new NotFoundError('workshop_day_not_found')

  const w = await ensureWorkshop(workshopId)
  const nextStarts = patch.startsAt ?? existing.startsAt
  const nextEnds = patch.endsAt ?? existing.endsAt
  if (nextEnds <= nextStarts) {
    throw new BadRequestError('ends_at_must_be_after_starts_at')
  }

  // Re-run room validation when the room, start, or end changes.
  const nextRoomId = patch.roomId ?? existing.roomId
  const roomChanged = patch.roomId !== undefined && patch.roomId !== existing.roomId
  const timeChanged = patch.startsAt !== undefined || patch.endsAt !== undefined
  if (nextRoomId && (roomChanged || timeChanged)) {
    await assertRoomInLocation(w.tenantId!, nextRoomId, w.locationId)
    await assertRoomAvailable(w.tenantId!, nextRoomId, nextStarts, nextEnds, {
      kind: 'workshop_day',
      id: dayId,
    })
  }

  const [row] = await db
    .update(workshopDays)
    .set({
      ...(patch.ord !== undefined ? { ord: patch.ord } : {}),
      ...(patch.roomId !== undefined ? { roomId: patch.roomId } : {}),
      ...(patch.startsAt !== undefined ? { startsAt: patch.startsAt } : {}),
      ...(patch.endsAt !== undefined ? { endsAt: patch.endsAt } : {}),
      ...(patch.basePriceSgd !== undefined ? { basePriceSgd: patch.basePriceSgd } : {}),
      ...(patch.capacityOnline !== undefined ? { capacityOnline: patch.capacityOnline } : {}),
      ...(patch.capacityWaitlist !== undefined ? { capacityWaitlist: patch.capacityWaitlist } : {}),
      ...(patch.capacityBuffer !== undefined ? { capacityBuffer: patch.capacityBuffer } : {}),
    })
    .where(eq(workshopDays.id, dayId))
    .returning()
  return row!
}

/**
 * Delete a workshop day. Refuses if any confirmed booking covers it (booking
 * → tier → tier_days). The check sums bookings on tiers whose tier_days set
 * includes this day.
 */
export async function deleteDay(workshopId: string, dayId: string): Promise<void> {
  await ensureWorkshop(workshopId)
  const [existing] = await db
    .select()
    .from(workshopDays)
    .where(and(eq(workshopDays.id, dayId), eq(workshopDays.workshopId, workshopId)))
    .limit(1)
  if (!existing) throw new NotFoundError('workshop_day_not_found')

  // Find tiers that include this day.
  const tierIdsTouchingDay = await db
    .select({ tierId: workshopTierDays.workshopTierId })
    .from(workshopTierDays)
    .where(eq(workshopTierDays.workshopDayId, dayId))

  if (tierIdsTouchingDay.length) {
    const tierIds = tierIdsTouchingDay.map(r => r.tierId)
    const rows = await db
      .select({ n: count() })
      .from(bookings)
      .where(
        and(
          inArray(bookings.workshopTierId, tierIds),
          // any booking still confirmed blocks the delete
          sql`${bookings.state} = 'confirmed'`,
        ),
      )
    const n = Number(rows[0]?.n ?? 0)
    if (n > 0) {
      throw new ConflictError('workshop_day_has_bookings', { bookings: n })
    }
  }

  await db.delete(workshopDays).where(eq(workshopDays.id, dayId))
}
