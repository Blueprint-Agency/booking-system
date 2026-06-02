import { Hono } from 'hono'

const app = new Hono()
  .get('/upcoming', c => c.json({ todo: 'upcoming bookings' }, 501))
  .get('/past', c => c.json({ todo: 'past bookings' }, 501))
  .get('/:id', c => c.json({ todo: 'booking detail' }, 501))
  .get('/:id/qr', c => c.json({ todo: 'booking QR PNG' }, 501))
  .post('/class', c => c.json({ todo: 'book class' }, 501))
  .post('/workshop', c =>
    c.json({ todo: 'workshop booking — initiates Stripe checkout' }, 501),
  )
  .delete('/:id', c => c.json({ todo: 'self-cancel' }, 501))

export default app
