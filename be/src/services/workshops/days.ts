import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  workshops,
  workshopDays,
  workshopTierDays,
} from '../../db/schema/schedule'
import { bookings } from '../../db/schema/bookings'
import { ConflictError, NotFoundError, BadRequestError } from '../../shared/errors'
import { assertRoomAvailable, assertRoomInLocation } from '../schedule/room-conflicts'
// The tenant gate every entry point here starts with: the workshop exists AND
// is this tenant's, so an id borrowed from another studio is
// `workshop_not_found` before any day is read, written or deleted. One
// definition, shared with ./tiers.ts.
import { getWorkshop as ensureWorkshop } from './publish'

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

export async function listDays(tenantId: string, workshopId: string): Promise<WorkshopDayRow[]> {
  await ensureWorkshop(tenantId, workshopId)
  return db
    .select()
    .from(workshopDays)
    .where(and(eq(workshopDays.tenantId, tenantId), eq(workshopDays.workshopId, workshopId)))
    .orderBy(workshopDays.ord)
}

export async function createDay(
  tenantId: string,
  workshopId: string,
  input: CreateDayInput,
): Promise<WorkshopDayRow> {
  const w = await ensureWorkshop(tenantId, workshopId)
  if (input.endsAt <= input.startsAt) throw new BadRequestError('ends_at_must_be_after_starts_at')
  await assertRoomInLocation(tenantId, input.roomId, w.locationId)
  await assertRoomAvailable(tenantId, input.roomId, input.startsAt, input.endsAt)
  const [row] = await db
    .insert(workshopDays)
    .values({
      tenantId,
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
  tenantId: string,
  workshopId: string,
  dayId: string,
  patch: Partial<CreateDayInput>,
): Promise<WorkshopDayRow> {
  const w = await ensureWorkshop(tenantId, workshopId)
  const [existing] = await db
    .select()
    .from(workshopDays)
    .where(
      and(
        eq(workshopDays.tenantId, tenantId),
        eq(workshopDays.id, dayId),
        eq(workshopDays.workshopId, workshopId),
      ),
    )
    .limit(1)
  if (!existing) throw new NotFoundError('workshop_day_not_found')

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
    await assertRoomInLocation(tenantId, nextRoomId, w.locationId)
    await assertRoomAvailable(tenantId, nextRoomId, nextStarts, nextEnds, {
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
    .where(and(eq(workshopDays.tenantId, tenantId), eq(workshopDays.id, dayId)))
    .returning()
  return row!
}

/**
 * Delete a workshop day. Refuses if any confirmed booking covers it (booking
 * → tier → tier_days). The check sums bookings on tiers whose tier_days set
 * includes this day.
 */
export async function deleteDay(
  tenantId: string,
  workshopId: string,
  dayId: string,
): Promise<void> {
  await ensureWorkshop(tenantId, workshopId)
  const [existing] = await db
    .select()
    .from(workshopDays)
    .where(
      and(
        eq(workshopDays.tenantId, tenantId),
        eq(workshopDays.id, dayId),
        eq(workshopDays.workshopId, workshopId),
      ),
    )
    .limit(1)
  if (!existing) throw new NotFoundError('workshop_day_not_found')

  // Find tiers that include this day.
  const tierIdsTouchingDay = await db
    .select({ tierId: workshopTierDays.workshopTierId })
    .from(workshopTierDays)
    .where(
      and(eq(workshopTierDays.tenantId, tenantId), eq(workshopTierDays.workshopDayId, dayId)),
    )

  if (tierIdsTouchingDay.length) {
    const tierIds = tierIdsTouchingDay.map(r => r.tierId)
    const rows = await db
      .select({ n: count() })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
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

  await db
    .delete(workshopDays)
    .where(and(eq(workshopDays.tenantId, tenantId), eq(workshopDays.id, dayId)))
}
