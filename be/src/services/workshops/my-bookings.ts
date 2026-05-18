import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import {
  workshops,
  workshopTiers,
  workshopTierDays,
  workshopDays,
} from '../../db/schema/schedule'
import { locations } from '../../db/schema/catalog'

export interface MyWorkshopBooking {
  id: string
  workshop_id: string
  workshop_name: string
  tier_id: string | null
  tier_name: string | null
  state: string
  check_in_state: string
  booked_at: Date
  cancelled_at: Date | null
  code: string
  qr_token: string
  location: { id: string; name: string; address: string | null } | null
  starts_at: Date | null
  ends_at: Date | null
  amount_paid_sgd: string | null
}

/**
 * Returns all workshop bookings (active and cancelled) for the given client,
 * joined with the workshop and the booking's tier. The earliest/latest day in
 * the booked tier is used as the booking's date range so the account view can
 * render past/upcoming sections without a second round-trip.
 */
export async function listMyWorkshopBookings(clientId: string): Promise<MyWorkshopBooking[]> {
  const rows = await db
    .select({
      bookingId: bookings.id,
      workshopId: bookings.workshopId,
      tierId: bookings.workshopTierId,
      state: bookings.state,
      checkInState: bookings.checkInState,
      bookedAt: bookings.bookedAt,
      cancelledAt: bookings.cancelledAt,
      code: bookings.code,
      qrToken: bookings.qrToken,
      workshopName: workshops.name,
      workshopLocationId: workshops.locationId,
      tierName: workshopTiers.name,
    })
    .from(bookings)
    .leftJoin(workshops, eq(workshops.id, bookings.workshopId))
    .leftJoin(workshopTiers, eq(workshopTiers.id, bookings.workshopTierId))
    .where(and(eq(bookings.clientId, clientId), eq(bookings.kind, 'workshop')))

  if (rows.length === 0) return []

  // For each tier, find the date range from workshop_tier_days → workshop_days.
  const tierIds = Array.from(
    new Set(rows.map(r => r.tierId).filter((v): v is string => Boolean(v))),
  )
  const dayRangeByTier = new Map<string, { startsAt: Date; endsAt: Date }>()
  if (tierIds.length) {
    const tierDayRows = await db
      .select({
        tierId: workshopTierDays.workshopTierId,
        startsAt: workshopDays.startsAt,
        endsAt: workshopDays.endsAt,
      })
      .from(workshopTierDays)
      .innerJoin(workshopDays, eq(workshopDays.id, workshopTierDays.workshopDayId))
      .where(inArray(workshopTierDays.workshopTierId, tierIds))
    for (const td of tierDayRows) {
      const cur = dayRangeByTier.get(td.tierId)
      if (!cur) {
        dayRangeByTier.set(td.tierId, { startsAt: td.startsAt, endsAt: td.endsAt })
      } else {
        if (td.startsAt < cur.startsAt) cur.startsAt = td.startsAt
        if (td.endsAt > cur.endsAt) cur.endsAt = td.endsAt
      }
    }
  }

  const locationIds = Array.from(
    new Set(rows.map(r => r.workshopLocationId).filter((v): v is string => Boolean(v))),
  )
  const locationById = new Map<string, { id: string; name: string; address: string | null }>()
  if (locationIds.length) {
    const locRows = await db.select().from(locations).where(inArray(locations.id, locationIds))
    for (const l of locRows) {
      locationById.set(l.id, { id: l.id, name: l.name, address: l.address })
    }
  }

  return rows.map(r => {
    const range = r.tierId ? dayRangeByTier.get(r.tierId) ?? null : null
    return {
      id: r.bookingId,
      workshop_id: r.workshopId ?? '',
      workshop_name: r.workshopName ?? 'Workshop',
      tier_id: r.tierId,
      tier_name: r.tierName,
      state: r.state,
      check_in_state: r.checkInState,
      booked_at: r.bookedAt,
      cancelled_at: r.cancelledAt,
      code: r.code,
      qr_token: r.qrToken,
      location: r.workshopLocationId ? locationById.get(r.workshopLocationId) ?? null : null,
      starts_at: range?.startsAt ?? null,
      ends_at: range?.endsAt ?? null,
      amount_paid_sgd: null,
    }
  })
}
