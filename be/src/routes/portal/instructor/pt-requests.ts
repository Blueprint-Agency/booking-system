import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'pending PT requests for own sessions' }, 501))
  .post('/:id/approve', c => c.json({ todo: 'approve own pt request' }, 501))
  .post('/:id/decline', c => c.json({ todo: 'decline own pt request' }, 501))

export default app
