import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { bookClass } from '../../services/bookings/book'

const app = new Hono()
  .get('/upcoming', c => c.json({ todo: 'upcoming bookings' }, 501))
  .get('/past', c => c.json({ todo: 'past bookings' }, 501))
  .get('/:id', c => c.json({ todo: 'booking detail' }, 501))
  .get('/:id/qr', c => c.json({ todo: 'booking QR PNG' }, 501))
  .post(
    '/class',
    zValidator('json', z.object({ class_id: z.string().uuid() })),
    async c => {
      const clientId = c.get('clientId')
      const { class_id } = c.req.valid('json')
      const res = await bookClass({ clientId, classId: class_id })
      return c.json({ booking_id: res.bookingId, qr_token: res.qrToken, code: res.code }, 201)
    },
  )
  .post('/workshop', c =>
    c.json({ todo: 'workshop booking — initiates Stripe checkout' }, 501),
  )
  .delete('/:id', c => c.json({ todo: 'self-cancel' }, 501))

export default app
