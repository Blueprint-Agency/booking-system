import { Hono } from 'hono'

const app = new Hono()
  .get('/eligible', c => c.json({ todo: 'rating-eligible bookings' }, 501))
  .get('/mine', c => c.json({ todo: 'own ratings (incl. past edit window)' }, 501))
  .post('/:bookingId', c => c.json({ todo: 'submit rating' }, 501))
  .patch('/:bookingId', c => c.json({ todo: 'edit rating within window' }, 501))

export default app
