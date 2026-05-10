import { Hono } from 'hono'
import { requireVerified } from '../../middleware/clerk-client'

const app = new Hono()
  .get('/upcoming', c => c.json({ todo: 'upcoming bookings' }, 501))
  .get('/past', c => c.json({ todo: 'past bookings' }, 501))
  .get('/:id', c => c.json({ todo: 'booking detail' }, 501))
  .get('/:id/qr', c => c.json({ todo: 'booking QR PNG' }, 501))
  .post('/class', requireVerified, c => c.json({ todo: 'book class (verification gated)' }, 501))
  .post('/workshop', requireVerified, c =>
    c.json({ todo: 'workshop booking — initiates Stripe checkout (verification gated)' }, 501),
  )
  .delete('/:id', requireVerified, c => c.json({ todo: 'self-cancel (verification gated)' }, 501))

export default app
