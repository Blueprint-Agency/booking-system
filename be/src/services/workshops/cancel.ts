import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { workshops } from '../../db/schema/schedule'
import { ConflictError, NotFoundError } from '../../shared/errors'

/**
 * v0: just flip lifecycle → 'cancelled' and stamp cancelled_at/by.
 * The Stripe refund fanout for paid bookings is deferred to the next slice
 * (per spec §8 and the "deferred" tag in the slice scope).
 */
export async function cancelWorkshop(workshopId: string, staffId: string) {
  const [existing] = await db.select().from(workshops).where(eq(workshops.id, workshopId)).limit(1)
  if (!existing) throw new NotFoundError('workshop_not_found')
  if (existing.lifecycle === 'cancelled') {
    throw new ConflictError('workshop_already_cancelled')
  }

  const [row] = await db
    .update(workshops)
    .set({
      lifecycle: 'cancelled',
      cancelledAt: new Date(),
      cancelledByStaffId: staffId,
    })
    .where(eq(workshops.id, workshopId))
    .returning()

  return row!
}
