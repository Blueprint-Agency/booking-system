/**
 * Attendance / check-in for class bookings.
 *
 *  - markAttendance: admin/instructor manual tick on the class roster. Only allowed once
 *    the class has started (now >= class.starts_at). Toggles bookings.check_in_state between
 *    'attended' and 'pending' and maintains the check_ins audit row.
 *  - flipNoShows: cron — bookings whose class ended while still pending become no-shows.
 */
import { and, eq, inArray, lt } from 'drizzle-orm'
import { db } from '../../db'
import { bookings, checkIns } from '../../db/schema/bookings'
import { classes } from '../../db/schema/schedule'
import { BadRequestError, ConflictError, NotFoundError, AppError } from '../../shared/errors'

export interface MarkAttendanceInput {
  bookingId: string
  staffId: string
  /** true → mark attended; false → undo back to pending. */
  attended: boolean
}

export async function markAttendance(
  input: MarkAttendanceInput,
): Promise<{ checkInState: 'attended' | 'pending' }> {
  const { bookingId, staffId, attended } = input

  return db.transaction(async tx => {
    const [bk] = await tx
      .select({
        id: bookings.id,
        kind: bookings.kind,
        state: bookings.state,
        startsAt: classes.startsAt,
        lifecycle: classes.lifecycle,
      })
      .from(bookings)
      .innerJoin(classes, eq(classes.id, bookings.classId))
      .where(eq(bookings.id, bookingId))
      .for('update')
      .limit(1)

    if (!bk) throw new NotFoundError('booking_not_found')
    if (bk.kind !== 'class') throw new BadRequestError('not_a_class_booking')
    if (bk.state === 'cancelled') throw new ConflictError('booking_cancelled')
    if (bk.lifecycle !== 'active') throw new ConflictError('class_cancelled')

    // The tick is only available from the class start time onwards.
    if (new Date() < bk.startsAt) throw new AppError(422, 'class_not_started')

    if (attended) {
      await tx
        .insert(checkIns)
        .values({ bookingId: bk.id, checkedInByStaffId: staffId, method: 'manual' })
        .onConflictDoNothing()
      // Attendance implies they showed up — clear any prior no-show on the booking.
      await tx
        .update(bookings)
        .set({ checkInState: 'attended', state: 'confirmed' })
        .where(eq(bookings.id, bk.id))
      return { checkInState: 'attended' }
    }

    // Undo: remove the check-in and reset to pending.
    await tx.delete(checkIns).where(eq(checkIns.bookingId, bk.id))
    await tx
      .update(bookings)
      .set({ checkInState: 'pending' })
      .where(eq(bookings.id, bk.id))
    return { checkInState: 'pending' }
  })
}

/**
 * No-show flip: bookings where class.ends_at < now AND check_in_state='pending'
 * → set check_in_state='no_show' and apply forfeit logic.
 */
export async function flipNoShows(): Promise<void> {
  const now = new Date()
  const endedClassIds = db
    .select({ id: classes.id })
    .from(classes)
    .where(lt(classes.endsAt, now))
  await db
    .update(bookings)
    .set({ checkInState: 'no_show', state: 'no_show', refundOutcome: 'forfeited' })
    .where(
      and(
        eq(bookings.kind, 'class'),
        eq(bookings.state, 'confirmed'),
        eq(bookings.checkInState, 'pending'),
        inArray(bookings.classId, endedClassIds),
      ),
    )
}
