import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { markAttendance } from '../../../services/bookings/check-in'
import { tenantId } from '../../../middleware/tenant'

const app = new Hono()
  .get('/', c => c.json({ todo: 'check-in candidates (ongoing + class-window)' }, 501))
  .post('/scan', c => c.json({ todo: 'verify QR/code, insert check_ins' }, 501))
  .post(
    '/manual',
    zValidator(
      'json',
      z.object({ booking_id: z.string().uuid(), attended: z.boolean().default(true) }),
    ),
    async c => {
      const staffId = c.get('staffUserId')
      const { booking_id, attended } = c.req.valid('json')
      const res = await markAttendance(tenantId(c), { bookingId: booking_id, staffId, attended })
      c.set('auditTarget' as any, { table: 'bookings', id: booking_id })
      return c.json({ check_in_state: res.checkInState })
    },
  )

export default app
