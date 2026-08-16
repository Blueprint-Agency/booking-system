import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { markAttendance } from '../../../services/bookings/check-in'

/**
 * Instructor check-in (spec §11 — "instructor scoped to own sessions").
 * Same service as the admin path; `source: 'instructor'` makes it assert the
 * caller is the session's MAIN instructor. That check lives in the service, not
 * here, so the admin route can't drift from it.
 */
const app = new Hono()
  .post('/scan', c => c.json({ todo: 'own session QR/code scan' }, 501))
  .post(
    '/manual',
    zValidator(
      'json',
      z.object({ booking_id: z.string().uuid(), attended: z.boolean().default(true) }),
    ),
    async c => {
      const staffId = c.get('staffUserId')
      const { booking_id, attended } = c.req.valid('json')
      const res = await markAttendance({
        bookingId: booking_id,
        staffId,
        attended,
        source: 'instructor',
      })
      c.set('auditTarget' as any, { table: 'bookings', id: booking_id })
      return c.json({ check_in_state: res.checkInState })
    },
  )

export default app
