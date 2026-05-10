import { Hono } from 'hono'

const app = new Hono()
  .get('/instructors/:id/availability', c => c.json({ todo: 'recurring + one-off slots' }, 501))
  .post('/instructors/:id/availability/recurring', c => c.json({ todo: 'insert weekly slot' }, 501))
  .delete('/instructors/:id/availability/recurring/:slotId', c => c.json({ todo: 'delete recurring slot' }, 501))
  .post('/instructors/:id/availability/oneoff', c => c.json({ todo: 'insert one-off slot' }, 501))
  .delete('/instructors/:id/availability/oneoff/:slotId', c => c.json({ todo: 'delete one-off slot' }, 501))

export default app
