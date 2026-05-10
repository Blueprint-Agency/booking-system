import { Hono } from 'hono'

const app = new Hono()
  .get('/classes', c => c.json({ todo: 'classes browse with auth (include_my_bookings)' }, 501))
  .get('/workshops', c => c.json({ todo: 'workshops browse' }, 501))
  .get('/workshops/:id', c => c.json({ todo: 'workshop detail' }, 501))
  .get('/class-packages', c => c.json({ todo: 'browse class packages' }, 501))
  .get('/pt-packages', c => c.json({ todo: 'browse pt packages' }, 501))
  .get('/instructors/:id/availability', c =>
    c.json({ todo: 'instructor availability slot enumeration for PT picker' }, 501),
  )

export default app
