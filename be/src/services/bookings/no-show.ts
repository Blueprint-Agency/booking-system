/**
 * Mark a confirmed booking as a no-show. Per spec §4: a no-show is a hardcoded full
 * forfeit (credit/session is NOT returned) and does NOT count toward the cancellation cap
 * — so we write no `cancellations` row, only flip the booking state.
 *
 * Guarded by the session start time (mirrors markAttendance): a no-show can only be
 * recorded once the session has started, so an admin can't forfeit a member's credit on
 * a class/PT that hasn't happened yet.
 */
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import { classes, ptSessions } from '../../db/schema/schedule'
import { AppError, BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'

export interface MarkNoShowInput {
  bookingId: string
  actorStaffId: string
}

export async function markNoShow(input: MarkNoShowInput): Promise<void> {
  await db.transaction(async tx => {
    const [bk] = await tx
      .select({
        id: bookings.id,
        state: bookings.state,
        kind: bookings.kind,
        classId: bookings.classId,
        ptSessionId: bookings.ptSessionId,
      })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .for('update')
      .limit(1)
    if (!bk) throw new NotFoundError('booking_not_found')
    if (bk.state !== 'confirmed') throw new ConflictError('not_confirmed')
    if (bk.kind === 'workshop') throw new BadRequestError('workshop_no_show_unsupported')

    // A no-show is only meaningful once the session has actually started.
    let startsAt: Date
    if (bk.kind === 'class') {
      const [cls] = await tx
        .select({ startsAt: classes.startsAt })
        .from(classes)
        .where(eq(classes.id, bk.classId!))
        .limit(1)
      if (!cls) throw new NotFoundError('class_not_found')
      startsAt = cls.startsAt
    } else {
      const [pt] = await tx
        .select({ startsAt: ptSessions.startsAt })
        .from(ptSessions)
        .where(eq(ptSessions.id, bk.ptSessionId!))
        .limit(1)
      if (!pt) throw new NotFoundError('pt_session_not_found')
      startsAt = pt.startsAt
    }
    if (new Date() < startsAt) throw new AppError(422, 'session_not_started')

    await tx
      .update(bookings)
      .set({ state: 'no_show', checkInState: 'no_show', refundOutcome: 'forfeited' })
      .where(eq(bookings.id, bk.id))
  })
}
