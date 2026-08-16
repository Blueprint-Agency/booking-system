/**
 * Attendance / check-in for class and PT bookings (spec §11 — workshops are not
 * check-in tracked).
 *
 * markAttendance is the admin/instructor manual tick on the roster. Only allowed
 * once the session has started (now >= starts_at). Toggles bookings.check_in_state
 * between 'attended' and 'pending' and maintains the check_ins audit row.
 *
 * There is deliberately NO automatic no-show flip — admin-restructure.md §11:
 * "No automatic no-show flip. Forfeits only fire when admin/instructor manually
 * marks the row `no-show`." A member who was simply never ticked stays `pending`.
 */
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { bookings, checkIns } from '../../db/schema/bookings'
import { classes, ptSessions } from '../../db/schema/schedule'
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  AppError,
} from '../../shared/errors'

export type MarkAttendanceSource = 'admin' | 'instructor'

export interface MarkAttendanceInput {
  bookingId: string
  staffId: string
  /** true → mark attended; false → undo back to pending. */
  attended: boolean
  /** Who is acting. Defaults to `admin` (the original caller). */
  source?: MarkAttendanceSource
}

export async function markAttendance(
  input: MarkAttendanceInput,
): Promise<{ checkInState: 'attended' | 'pending' }> {
  const { bookingId, staffId, attended } = input
  const source: MarkAttendanceSource = input.source ?? 'admin'

  return db.transaction(async tx => {
    const [bk] = await tx
      .select({
        id: bookings.id,
        kind: bookings.kind,
        state: bookings.state,
        classId: bookings.classId,
        ptSessionId: bookings.ptSessionId,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for('update')
      .limit(1)

    if (!bk) throw new NotFoundError('booking_not_found')
    if (bk.kind === 'workshop') throw new BadRequestError('workshop_check_in_unsupported')
    if (bk.state === 'cancelled') throw new ConflictError('booking_cancelled')

    // Class and PT carry the same three facts under different column names.
    const [ses] =
      bk.kind === 'class'
        ? await tx
            .select({
              startsAt: classes.startsAt,
              lifecycle: classes.lifecycle,
              mainInstructorId: classes.mainInstructorId,
            })
            .from(classes)
            .where(eq(classes.id, bk.classId!))
            .limit(1)
        : await tx
            .select({
              startsAt: ptSessions.startsAt,
              lifecycle: ptSessions.lifecycle,
              mainInstructorId: ptSessions.instructorId,
            })
            .from(ptSessions)
            .where(eq(ptSessions.id, bk.ptSessionId!))
            .limit(1)

    if (!ses) {
      throw new NotFoundError(bk.kind === 'class' ? 'class_not_found' : 'pt_session_not_found')
    }
    if (ses.lifecycle !== 'active') throw new ConflictError('session_cancelled')

    // Instructors tick their OWN sessions only (§11). Checked in the service, not
    // the route, so no future caller can skip it — same shape as cancelClass.
    if (source === 'instructor' && ses.mainInstructorId !== staffId) {
      throw new ForbiddenError('not_your_session')
    }

    // The tick is only available from the session start time onwards.
    if (new Date() < ses.startsAt) throw new AppError(422, 'session_not_started')

    if (attended) {
      await tx
        .insert(checkIns)
        .values({ bookingId: bk.id, checkedInByStaffId: staffId, method: 'manual' })
        .onConflictDoNothing()
      // Attendance implies they showed up — clear any prior no-show AND the forfeit
      // that came with it, or the member stays "forfeited" on a session they attended.
      await tx
        .update(bookings)
        .set({ checkInState: 'attended', state: 'confirmed', refundOutcome: 'n_a' })
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
