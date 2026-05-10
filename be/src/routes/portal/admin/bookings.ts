import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'list bookings with filters' }, 501))
  .get('/:id', c => c.json({ todo: 'detail' }, 501))
  .post('/:id/cancel', c => c.json({ todo: 'admin force-cancel — always full refund' }, 501))
  .post('/:id/no-show', c => c.json({ todo: 'mark no-show + forfeit logic' }, 501))

export default app
