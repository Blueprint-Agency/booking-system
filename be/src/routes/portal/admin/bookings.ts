import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { cancelBooking } from '../../../services/bookings/cancel'
import { markNoShow } from '../../../services/bookings/no-show'
import { tenantId } from '../../../middleware/tenant'

const idParam = z.object({ id: z.string().uuid() })

const app = new Hono()
  .get('/', c => c.json({ todo: 'list bookings with filters' }, 501))
  .get('/:id', c => c.json({ todo: 'detail' }, 501))
  .post('/:id/cancel', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const staffId = c.get('staffUserId')
    const res = await cancelBooking(tenantId(c), {
      bookingId: id,
      source: 'admin',
      actorStaffId: staffId,
    })
    c.set('auditTarget' as any, { table: 'bookings', id })
    return c.json({ refund_outcome: res.refundOutcome, refund_fired: res.refundFired })
  })
  .post('/:id/no-show', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const staffId = c.get('staffUserId')
    await markNoShow(tenantId(c), { bookingId: id, actorStaffId: staffId })
    c.set('auditTarget' as any, { table: 'bookings', id })
    return c.json({ ok: true })
  })

export default app
