import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { workshops } from '../../db/schema/schedule'
import { bookings } from '../../db/schema/bookings'
import { inboxItems } from '../../db/schema/inbox'
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'

/**
 * Cancel a workshop and all confirmed workshop bookings. **Nobody is refunded
 * automatically** (#272): each booking is marked cancelled with
 * refund_outcome='n_a' rather than falsely claiming stripe_refunded, and the
 * admin decides, one member at a time, from that member's page — where a paid
 * booking cancelled here stays listed with its Refund action
 * (`listWorkshopPurchases`). Refunding it later is what records it refunded.
 *
 * Write permission is checked HERE rather than by a path prefix at the router,
 * because this action is mounted under two paths (/workshops/:id/cancel and
 * /schedule/workshops/:id/cancel). A prefix gate has to be repeated per mount
 * and a third mount silently re-opens the hole; the check travels with the
 * action instead.
 */
export async function cancelWorkshop(
  tenantId: string,
  workshopId: string,
  staffId: string,
  actorRole: string,
) {
  if (actorRole !== 'admin') {
    throw new ForbiddenError('forbidden_role', { required: ['admin'], actual: actorRole })
  }
  return db.transaction(async tx => {
    const [existing] = await tx
      .select()
      .from(workshops)
      .where(and(eq(workshops.tenantId, tenantId), eq(workshops.id, workshopId)))
      .for('update')
      .limit(1)
    if (!existing) throw new NotFoundError('workshop_not_found')
    if (existing.lifecycle === 'cancelled') {
      throw new ConflictError('workshop_already_cancelled')
    }

    const now = new Date()
    const [row] = await tx
      .update(workshops)
      .set({
        lifecycle: 'cancelled',
        cancelledAt: now,
        cancelledByStaffId: staffId,
      })
      .where(and(eq(workshops.tenantId, tenantId), eq(workshops.id, workshopId)))
      .returning()

    const affected = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.kind, 'workshop'),
          eq(bookings.workshopId, workshopId),
          eq(bookings.state, 'confirmed'),
        ),
      )
      .for('update')

    if (affected.length) {
      await tx
        .update(bookings)
        .set({
          state: 'cancelled',
          refundOutcome: 'n_a',
          checkInState: 'n_a',
          cancelledAt: now,
        })
        .where(
          and(
            eq(bookings.tenantId, tenantId),
            eq(bookings.kind, 'workshop'),
            eq(bookings.workshopId, workshopId),
            eq(bookings.state, 'confirmed'),
          ),
        )
    }

    await tx.insert(inboxItems).values({
      tenantId,
      type: 'admin_cancel_workshop',
      payload: {
        workshopId,
        cancelledByStaffId: staffId,
        affectedBookings: affected.length,
        refundOutcome: 'n_a',
        at: now.toISOString(),
      },
    })

    return row!
  })
}
