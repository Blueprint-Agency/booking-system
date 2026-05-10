import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'list own stripe_payments' }, 501))
  .get('/:id', c => c.json({ todo: 'payment detail' }, 501))

export default app
