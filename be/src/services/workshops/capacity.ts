/**
 * How full a workshop's days are, and whether a tier can still be sold: the
 * one rule the purchase gate (./book.ts) and the member catalogue
 * (./catalog.ts) both read, so the catalogue never offers a place the gate
 * then refuses.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import { workshopTierDays } from '../../db/schema/schedule'

/**
 * Confirmed workshop places holding a seat on each of `dayIds`, across every
 * tier that covers the day. A count for staff and for the rules — never sent
 * to a member (fe-client-features §4.1).
 *
 * The count that decides "full" is the sharp one: unscoped it would add
 * another studio's seats to this studio's day and turn a workshop away that
 * has room.
 */
export async function confirmedPlacesByDay(tenantId: string, dayIds: string[]): Promise<Map<string, number>> {
  if (dayIds.length === 0) return new Map()
  const counts = await db
    .select({
      dayId: workshopTierDays.workshopDayId,
      cnt: sql<number>`count(*)::int`,
    })
    .from(bookings)
    .innerJoin(workshopTierDays, eq(workshopTierDays.workshopTierId, bookings.workshopTierId))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(workshopTierDays.tenantId, tenantId),
        eq(bookings.kind, 'workshop'),
        eq(bookings.state, 'confirmed'),
        inArray(workshopTierDays.workshopDayId, dayIds),
      ),
    )
    .groupBy(workshopTierDays.workshopDayId)
  return new Map(counts.map(c => [c.dayId, Number(c.cnt)]))
}

/**
 * A tier has room only while every day it covers has a seat left: its
 * capacity is the smallest of its days' (fe-client-features §4.1).
 */
export function tierHasRoom(
  days: { dayId: string; cap: number }[],
  bookedByDay: Map<string, number>,
): boolean {
  return days.every(d => (bookedByDay.get(d.dayId) ?? 0) < d.cap)
}
