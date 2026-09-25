/**
 * Promotion: a freed online seat goes to the head of the class's line
 * (spec-waitlist.md §5).
 *
 * `promoteFromWaitlist` runs inside the transaction that freed the seat —
 * `cancelBooking`, so a member cancel, an admin cancel and a Refund- or
 * complimentary-driven cancel all promote the same way — under the class row
 * lock. Two cancels at once therefore take turns: the second sees the seat the
 * first filled, and one waiting member is booked once and debited once.
 *
 * Inside the Cancellation Window nobody is moved automatically: a promoted
 * member must always be able to cancel free. Staff fill those seats by hand.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { waitlistEntries } from '../../db/schema/bookings'
import { classes } from '../../db/schema/schedule'
import { classTypes, locations } from '../../db/schema/catalog'
import { clients, staffUsers } from '../../db/schema/identity'
import type { Tx } from '../schedule/roster'
import { holdsSeat, lockClass, payAndBook } from '../bookings/book'
import { countSeats } from '../bookings/seats'
import { sendTemplatedEmail } from '../notifications/send'
import { loadTenantById } from '../tenants/tenants'
import { reportError } from '../../shared/logger'
import { beforeWindow, nextToPromote, waitlistClosesAt, type PromotionOutcome } from './rules'
import { classWindowHours, waitingLine } from './line'

export interface Promotion {
  entryId: string
  bookingId: string
  clientId: string
  classId: string
}

/**
 * Fill the class's free online seats from its line, in order. A member whose
 * package cannot pay now is skipped and stays `waiting` — buying a package puts
 * them back in contention for the next seat. Returns who was booked, for the
 * caller to email once the transaction has committed.
 */
export async function promoteFromWaitlist(
  tx: Tx,
  tenantId: string,
  classId: string,
  now: Date,
): Promise<Promotion[]> {
  const cls = await lockClass(tx, tenantId, classId)
  if (!cls || cls.lifecycle !== 'active') return []
  if (!beforeWindow(cls.startsAt, await classWindowHours(tenantId), now)) return []

  const line = await waitingLine(tx, tenantId, classId, now)
  const outcomes = new Map<string, PromotionOutcome>()
  const promoted: Promotion[] = []

  for (;;) {
    const counts = await countSeats(tx, tenantId, classId)
    if (counts.onlineUsed >= cls.capacityOnline) break
    const next = nextToPromote(line, outcomes)
    if (!next) break

    // A member already holding a seat is never booked twice. Booking by hand
    // settles their place in line, so this is a guard, not a path.
    if (await holdsSeat(tx, tenantId, next.clientId, classId)) {
      outcomes.set(next.id, 'already_booked')
      continue
    }

    const paid = await payAndBook(tx, tenantId, cls, { clientId: next.clientId, seat: 'online', useCredits: false, now })
    if (!paid.ok) {
      outcomes.set(next.id, paid.refusal)
      continue
    }

    await tx
      .update(waitlistEntries)
      .set({ status: 'promoted', bookingId: paid.booking.bookingId, resolvedAt: now, resolvedBy: 'system' })
      .where(and(eq(waitlistEntries.tenantId, tenantId), eq(waitlistEntries.id, next.id)))
    outcomes.set(next.id, 'promoted')
    promoted.push({ entryId: next.id, bookingId: paid.booking.bookingId, clientId: next.clientId, classId })
  }

  return promoted
}

/**
 * Email each promoted member `class_waitlist_promoted` (§11). Runs after the
 * booking has committed and never throws: a missing template or a mail fault
 * must not undo a seat that is already theirs. Failures are reported.
 */
export async function sendPromotionEmails(tenantId: string, promotions: readonly Promotion[]): Promise<void> {
  for (const p of promotions) {
    try {
      const [row] = await db
        .select({
          clientName: clients.name,
          clientEmail: clients.email,
          className: classTypes.name,
          startsAt: classes.startsAt,
          locationName: locations.name,
          instructorName: staffUsers.name,
        })
        .from(classes)
        .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
        .innerJoin(locations, eq(locations.id, classes.locationId))
        .innerJoin(staffUsers, eq(staffUsers.id, classes.mainInstructorId))
        .innerJoin(clients, and(eq(clients.tenantId, classes.tenantId), eq(clients.id, p.clientId)))
        .where(and(eq(classes.tenantId, tenantId), eq(classes.id, p.classId)))
        .limit(1)
      if (!row) continue
      const tenant = await loadTenantById(tenantId)
      const timeZone = tenant?.timezone ?? 'UTC'
      const date = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
      const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true })
      const cancelBy = waitlistClosesAt(row.startsAt, await classWindowHours(tenantId))

      await sendTemplatedEmail({
        tenantId,
        slug: 'class_waitlist_promoted',
        recipient: { email: row.clientEmail, userId: p.clientId, userKind: 'client' },
        variables: {
          client_name: row.clientName,
          class_name: row.className,
          date: date.format(row.startsAt),
          time: time.format(row.startsAt),
          location_name: row.locationName,
          instructor_name: row.instructorName || 'your instructor',
          cancel_by: `${date.format(cancelBy)}, ${time.format(cancelBy)}`,
        },
      })
    } catch (err) {
      reportError(err, 'waitlist promotion email failed', { scope: 'waitlist', bookingId: p.bookingId })
    }
  }
}
