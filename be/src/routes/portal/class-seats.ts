import { z } from 'zod'
import {
  serializeMemberPackageForClass,
  serializePaidWith,
  type BookClassResult,
  type MemberPackagesForClass,
} from '../../services/bookings/book'
import type { ClassDetail } from '../../services/schedule/detail'
import type { ScheduleEntryRow } from '../../services/schedule/timetable'
import { staffCancelPreviewJson } from '../../services/bookings/staff-cancel-preview'
import { staffCancellationJson } from '../../services/bookings/cancellation-summary'

/**
 * The seat shapes the admin and instructor portals share (spec-waitlist.md §2,
 * §10), so the two session pages read one wire format. Formatting only: every
 * number here was counted by `services/bookings/seats`.
 */

/**
 * `POST …/schedule/classes/:id/bookings`. `overbook` is honoured for admins
 * only. `client_package_id` is staff's pick of the member's packages (#333);
 * absent, the Default payer pays. `allow_clash` is staff's "Book anyway" after a
 * `time_clash`: the member holds a booking at an overlapping time.
 */
export const staffBookingSchema = z.object({
  client_id: z.string().uuid(),
  overbook: z.boolean().optional(),
  client_package_id: z.string().uuid().optional(),
  allow_clash: z.boolean().optional(),
})

export function staffBookingJson(res: BookClassResult) {
  return {
    booking_id: res.bookingId,
    seat: res.seat,
    qr_token: res.qrToken,
    code: res.code,
    // The package staff charged, named so they know what was spent.
    paid_with: serializePaidWith(res.paidWith),
  }
}

/** `GET …/schedule/classes/:id/packages?client_id=`: whose packages to read. */
export const staffPackagesQuery = z.object({ client_id: z.string().uuid() })

/** The member's class packages for one class, as the Book sheet's `my_packages` reads them. */
export function staffPackagesJson(res: MemberPackagesForClass) {
  return {
    default_client_package_id: res.defaultPayerId,
    packages: res.packages.map(serializeMemberPackageForClass),
  }
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
      // Null on a row "Cancel booking" is not offered on (#320).
      cancel_preview: staffCancelPreviewJson(a.cancelPreview),
    })),
    // Apart from the roster, never checked in (#352).
    cancelled_bookings: d.cancelledBookings.map(b => ({
      booking_id: b.bookingId,
      client: b.client,
      credits_used: b.creditsUsed,
      ...staffCancellationJson(b.cancellation),
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
