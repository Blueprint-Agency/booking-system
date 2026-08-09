/**
 * Admin cancels an entire class instance — bulk full refund to every confirmed booker.
 * See admin-restructure.md §10 (class detail) + §13 (inbox).
 *
 * Admin cancellation bypasses window/cap (always full refund). Unlimited bookings
 * (0 credits used) just release the seat — outcome `n_a`, no balance write. All in one
 * transaction; the class row is locked FOR UPDATE so it can't race in-flight bookings/cancels.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { classes } from '../../db/schema/schedule'
import { bookings, cancellations } from '../../db/schema/bookings'
import { inboxItems } from '../../db/schema/inbox'
import { refundCredits } from '../packages/ledger'
import { ConflictError, NotFoundError } from '../../shared/errors'

export interface CancelClassInput {
  classId: string
  actorStaffId: string
}

export interface CancelClassResult {
  totalBookings: number
  refundedCount: number
}

export async function cancelClass(input: CancelClassInput): Promise<CancelClassResult> {
  const { classId, actorStaffId } = input

  return db.transaction(async tx => {
    const [cls] = await tx
      .select({ id: classes.id, lifecycle: classes.lifecycle })
      .from(classes)
      .where(eq(classes.id, classId))
      .for('update')
      .limit(1)
    if (!cls) throw new NotFoundError('class_not_found')
    if (cls.lifecycle !== 'active') throw new ConflictError('class_not_active')

    const now = new Date()

    // Flip the class.
    await tx
      .update(classes)
      .set({ lifecycle: 'cancelled', cancelledAt: now, cancelledByStaffId: actorStaffId })
      .where(eq(classes.id, classId))

    // All confirmed bookings → cancel + refund.
    const confirmed = await tx
      .select({
        id: bookings.id,
        clientId: bookings.clientId,
        clientPackageId: bookings.clientPackageId,
        used: bookings.creditsOrSessionsUsed,
      })
      .from(bookings)
      .where(and(eq(bookings.classId, classId), eq(bookings.state, 'confirmed')))
      .for('update')

    let refundedCount = 0
    for (const bk of confirmed) {
      const used = bk.used ?? 0
      const refundFired = used > 0 && !!bk.clientPackageId

      if (refundFired) {
        // Ledger re-derives `active` — an emptied bundle refunded here is
        // spendable again (it previously came back unusable).
        await refundCredits(tx, {
          clientId: bk.clientId,
          clientPackageId: bk.clientPackageId!,
          amount: used,
          reason: 'admin_class_cancellation_refund',
          actedByStaffId: actorStaffId,
        })
        refundedCount++
      }

      await tx.insert(cancellations).values({
        bookingId: bk.id,
        clientId: bk.clientId,
        kind: 'class',
        source: 'admin',
        wasWithinWindow: true,
        wasWithinCap: true,
        refundFired,
        cancelledAt: now,
      })

      await tx
        .update(bookings)
        .set({
          state: 'cancelled',
          refundOutcome: refundFired ? 'credit_returned' : 'n_a',
          checkInState: 'n_a',
          cancelledAt: now,
        })
        .where(eq(bookings.id, bk.id))
    }

    // Inbox notification per §13.
    await tx.insert(inboxItems).values({
      type: 'admin_cancel_class_pt',
      payload: {
        kind: 'class',
        classId,
        cancelledByStaffId: actorStaffId,
        totalBookings: confirmed.length,
        refundedCount,
        at: now.toISOString(),
      },
    })

    return { totalBookings: confirmed.length, refundedCount }
  })
}
