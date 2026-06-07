/**
 * Mark a confirmed booking as a no-show. Per spec §4: a no-show is a hardcoded full
 * forfeit (credit/session is NOT returned) and does NOT count toward the cancellation cap
 * — so we write no `cancellations` row, only flip the booking state.
 */
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import { ConflictError, NotFoundError } from '../../shared/errors'

export interface MarkNoShowInput {
  bookingId: string
  actorStaffId: string
}

export async function markNoShow(input: MarkNoShowInput): Promise<void> {
  await db.transaction(async tx => {
    const [bk] = await tx
      .select({ id: bookings.id, state: bookings.state })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .for('update')
      .limit(1)
    if (!bk) throw new NotFoundError('booking_not_found')
    if (bk.state !== 'confirmed') throw new ConflictError('not_confirmed')

    await tx
      .update(bookings)
      .set({ state: 'no_show', checkInState: 'no_show', refundOutcome: 'forfeited' })
      .where(eq(bookings.id, bk.id))
  })
}
