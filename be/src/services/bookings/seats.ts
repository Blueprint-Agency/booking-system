/**
 * Seats: the one place a class's confirmed bookings are counted for capacity
 * (spec-waitlist.md §2, #307).
 *
 * A class has `capacity_online` seats members book themselves and
 * `capacity_buffer` seats only staff fill; **attendance capacity** is their sum.
 * `capacity_waitlist` is not a seat. Each booking records which seat it holds
 * (`bookings.seat`), so "how full is this class" is a count by seat, never a
 * count of every confirmed row against one number.
 *
 * `countSeats` / `countSeatsByClass` read; `seatFor` decides, purely, which seat
 * a new booking takes. The booking service, the member catalogue, the portal
 * timetable and the session detail all come through here, so none of them can
 * disagree about what "full" means.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import type { BookingSeat } from '../../db/enums'
import type { Tx } from '../schedule/roster'

export interface SeatCounts {
  onlineUsed: number
  bufferUsed: number
  overbookUsed: number
  /** Every confirmed booking: the people staff expect in the room. */
  attending: number
}

export interface SeatCapacities {
  capacityOnline: number
  capacityBuffer: number
}

/** Who is asking for the seat. A member books themselves; staff book a member. */
export type SeatRole = 'member' | 'admin' | 'instructor'

export type SeatDecision = { ok: true; seat: BookingSeat } | { ok: false; refusal: 'class_full' }

const EMPTY: SeatCounts = { onlineUsed: 0, bufferUsed: 0, overbookUsed: 0, attending: 0 }

/**
 * The seat a new booking takes, or why there is none.
 *
 * - A member takes an online seat while one is free, and nothing else.
 * - Staff take a buffer seat while one is free. Staff never take an online seat:
 *   those are the members' (and the waitlist's), and a staff booking must leave
 *   `spots_left` where it was.
 * - With the buffer full, an admin who said `overbook` gets an overbook seat. An
 *   instructor never overbooks.
 */
export function seatFor(
  counts: SeatCounts,
  capacities: SeatCapacities,
  role: SeatRole,
  overbook: boolean,
): SeatDecision {
  if (role === 'member') {
    return counts.onlineUsed < capacities.capacityOnline
      ? { ok: true, seat: 'online' }
      : { ok: false, refusal: 'class_full' }
  }
  if (counts.bufferUsed < capacities.capacityBuffer) return { ok: true, seat: 'buffer' }
  if (role === 'admin' && overbook) return { ok: true, seat: 'overbook' }
  return { ok: false, refusal: 'class_full' }
}

/**
 * The seat staff "Add to class" gives a member from the waitlist (§7): a freed
 * online seat first — the one the line was waiting for — and only then what a
 * staff booking may take (`seatFor`).
 */
export function staffPromotionSeat(
  counts: SeatCounts,
  capacities: SeatCapacities,
  role: Exclude<SeatRole, 'member'>,
  overbook: boolean,
): SeatDecision {
  if (counts.onlineUsed < capacities.capacityOnline) return { ok: true, seat: 'online' }
  return seatFor(counts, capacities, role, overbook)
}

/** Online seats a member can still book. The member catalogue's `spots_left`. */
export function spotsLeft(counts: SeatCounts, capacities: Pick<SeatCapacities, 'capacityOnline'>): number {
  return Math.max(0, capacities.capacityOnline - counts.onlineUsed)
}

/** The most people the roster holds without an overbook. The waitlist is not a seat. */
export function attendanceCapacity(capacities: SeatCapacities): number {
  return capacities.capacityOnline + capacities.capacityBuffer
}

type Reader = typeof db | Tx

/** Seat counts for many classes at once; a class with no bookings reads all zeros. */
export async function countSeatsByClass(
  reader: Reader,
  tenantId: string,
  classIds: string[],
): Promise<Map<string, SeatCounts>> {
  const out = new Map<string, SeatCounts>()
  if (classIds.length === 0) return out
  const rows = await reader
    .select({
      classId: bookings.classId,
      online: sql<number>`count(*) filter (where ${bookings.seat} = 'online')::int`,
      buffer: sql<number>`count(*) filter (where ${bookings.seat} = 'buffer')::int`,
      overbook: sql<number>`count(*) filter (where ${bookings.seat} = 'overbook')::int`,
      attending: sql<number>`count(*)::int`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        inArray(bookings.classId, classIds),
        eq(bookings.state, 'confirmed'),
      ),
    )
    .groupBy(bookings.classId)
  for (const r of rows) {
    if (!r.classId) continue
    out.set(r.classId, {
      onlineUsed: Number(r.online),
      bufferUsed: Number(r.buffer),
      overbookUsed: Number(r.overbook),
      attending: Number(r.attending),
    })
  }
  return out
}

/** Seat counts for one class. Pass the transaction that holds the class row lock when deciding a seat. */
export async function countSeats(reader: Reader, tenantId: string, classId: string): Promise<SeatCounts> {
  return (await countSeatsByClass(reader, tenantId, [classId])).get(classId) ?? { ...EMPTY }
}

/** Seat counts for `id`, or zeros. For the list reads, which hold a map. */
export function seatsOf(map: Map<string, SeatCounts>, id: string): SeatCounts {
  return map.get(id) ?? { ...EMPTY }
}
