import { z } from 'zod'
import type { BookClassResult } from '../../services/bookings/book'
import type { ClassDetail } from '../../services/schedule/detail'
import type { ScheduleEntryRow } from '../../services/schedule/timetable'

/**
 * The seat shapes the admin and instructor portals share (spec-waitlist.md §2,
 * §10), so the two session pages read one wire format. Formatting only: every
 * number here was counted by `services/bookings/seats`.
 */

/** `POST …/schedule/classes/:id/bookings`. `overbook` is honoured for admins only. */
export const staffBookingSchema = z.object({
  client_id: z.string().uuid(),
  overbook: z.boolean().optional(),
})

export function staffBookingJson(res: BookClassResult) {
  return { booking_id: res.bookingId, seat: res.seat, qr_token: res.qrToken, code: res.code }
}

/** A timetable entry's seats. Null on every kind but a class. */
export function seatFields(e: ScheduleEntryRow) {
  return {
    attendance_capacity: e.seats ? e.capacity : null,
    online_used: e.seats?.onlineUsed ?? null,
    buffer_used: e.seats?.bufferUsed ?? null,
    overbook_used: e.seats?.overbookUsed ?? null,
    attending: e.seats?.attending ?? null,
    waiting: e.waiting,
  }
}

/** A class detail's seat counts, its roster (each row tagged with its seat) and its waitlist. */
export function classSeatsJson(d: ClassDetail) {
  return {
    booked_count: d.bookedCount,
    attendance_capacity: d.attendanceCapacity,
    online_used: d.seats.onlineUsed,
    buffer_used: d.seats.bufferUsed,
    overbook_used: d.seats.overbookUsed,
    attending: d.seats.attending,
    attendees: d.attendees.map(a => ({
      booking_id: a.bookingId,
      client: a.client,
      package_kind: a.packageKind,
      credits_used: a.creditsUsed,
      check_in_state: a.checkInState,
      code: a.code,
      seat: a.seat,
      promoted_from_waitlist: a.promotedFromWaitlist,
    })),
    waiting: d.waitlist.length,
    waitlist_enabled: d.waitlistEnabled,
    waitlist: d.waitlist.map(w => ({
      entry_id: w.entryId,
      position: w.position,
      client: w.client,
      joined_at: w.joinedAt.toISOString(),
      payment_status:
        w.paymentStatus.status === 'pending'
          ? { status: 'pending', package_name: w.paymentStatus.packageName }
          : { status: 'cannot_pay', reason: w.paymentStatus.reason },
    })),
  }
}
