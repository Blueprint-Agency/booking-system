import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { markNoShow } from '../../../services/bookings/no-show'
import { tenantId } from '../../../middleware/tenant'
import { bookingCancelRoutes } from '../booking-cancel'

const idParam = z.object({ id: z.string().uuid() })

const app = new Hono()
  .route('/', bookingCancelRoutes('admin'))
  .post('/:id/no-show', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const staffId = c.get('staffUserId')
    await markNoShow(tenantId(c), { bookingId: id, actorStaffId: staffId })
    c.set('auditTarget', { table: 'bookings', id })
    return c.json({ ok: true })
  })

export default app
