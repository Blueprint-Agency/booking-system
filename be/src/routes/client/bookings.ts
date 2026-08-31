import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { bookClass } from '../../services/bookings/book'
import { cancelBooking } from '../../services/bookings/cancel'
import { listClassBookings, getClassBookingDetail, type ClassBookingRow } from '../../services/bookings/list'
import { tenantId } from '../../middleware/tenant'

function bookingRow(b: ClassBookingRow) {
  return {
    booking_id: b.bookingId,
    class_id: b.classId,
    name: b.name,
    instructor: b.instructor,
    location: b.location,
    room: b.room,
    starts_at: b.startsAt.toISOString(),
    ends_at: b.endsAt.toISOString(),
    credit_cost: b.creditCost,
    credits_used: b.creditsUsed,
    package_kind: b.packageKind,
    was_unlimited: b.wasUnlimited,
    check_in_state: b.checkInState,
    state: b.state,
    qr_token: b.qrToken,
    code: b.code,
  }
}

const app = new Hono()
  .get('/upcoming', async c => {
    const clientId = c.get('clientId')
    const rows = await listClassBookings(tenantId(c), clientId, 'upcoming')
    return c.json({ bookings: rows.map(bookingRow) })
  })
  .get('/past', async c => {
    const clientId = c.get('clientId')
    const rows = await listClassBookings(tenantId(c), clientId, 'past')
    return c.json({ bookings: rows.map(bookingRow) })
  })
  .get('/:id/qr', c => c.json({ todo: 'booking QR PNG' }, 501))
  .get('/:id', zValidator('param', z.object({ id: z.string().uuid() })), async c => {
    const clientId = c.get('clientId')
    const { id } = c.req.valid('param')
    const row = await getClassBookingDetail(tenantId(c), clientId, id)
    return c.json(bookingRow(row))
  })
  .post(
    '/class',
    zValidator(
      'json',
      z.object({ class_id: z.string().uuid(), use_credits: z.boolean().optional() }),
    ),
    async c => {
      const clientId = c.get('clientId')
      const { class_id, use_credits } = c.req.valid('json')
      const res = await bookClass(tenantId(c), {
        clientId,
        classId: class_id,
        useCredits: use_credits,
      })
      return c.json({ booking_id: res.bookingId, qr_token: res.qrToken, code: res.code }, 201)
    },
  )
  .delete('/:id', zValidator('param', z.object({ id: z.string().uuid() })), async c => {
    const clientId = c.get('clientId')
    const { id } = c.req.valid('param')
    const res = await cancelBooking(tenantId(c), { bookingId: id, source: 'client', clientId })
    return c.json({ refund_outcome: res.refundOutcome, refund_fired: res.refundFired })
  })

export default app
