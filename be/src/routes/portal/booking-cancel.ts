import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { cancelBooking, type StaffCancelSource } from '../../services/bookings/cancel'
import { tenantId } from '../../middleware/tenant'

/** Staff choose, every time: neither is assumed. */
const staffCancelSchema = z.object({ credit: z.enum(['return', 'keep']) })

/**
 * A staff member cancels one member's booking (#320), mounted under `/bookings`
 * by both the admin and the instructor portal. The role is the mount's, never
 * the body's; an instructor reaches only the classes they lead (the service
 * checks, `not_your_session`).
 *
 *   POST /:id/cancel  { credit: 'return' | 'keep' }
 */
export function bookingCancelRoutes(role: StaffCancelSource) {
  return new Hono().post(
    '/:id/cancel',
    zValidator('param', z.object({ id: z.string().uuid() })),
    zValidator('json', staffCancelSchema),
    async c => {
      const { id } = c.req.valid('param')
      const res = await cancelBooking(tenantId(c), {
        bookingId: id,
        source: role,
        actorStaffId: c.get('staffUserId'),
        credit: c.req.valid('json').credit,
      })
      c.set('auditTarget' as any, { table: 'bookings', id })
      return c.json({ refund_outcome: res.refundOutcome, refund_fired: res.refundFired })
    },
  )
}
