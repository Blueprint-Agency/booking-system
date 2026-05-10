import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'unified timetable: classes + workshops + confirmed pt_sessions' }, 501))
  .post('/classes', c => c.json({ todo: 'create class instance' }, 501))
  .patch('/classes/:id', c => c.json({ todo: 'edit class — reject if material change with bookings' }, 501))
  .post('/classes/:id/cancel', c => c.json({ todo: 'admin-cancel class' }, 501))
  .post('/workshops', c => c.json({ todo: 'create workshop with tiers + images + instructors' }, 501))
  .patch('/workshops/:id', c => c.json({ todo: 'edit workshop' }, 501))
  .post('/workshops/:id/cancel', c => c.json({ todo: 'admin-cancel workshop + refund fanout' }, 501))

export default app
