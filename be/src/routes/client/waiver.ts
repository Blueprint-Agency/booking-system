import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'singleton waiver + own signature' }, 501))
  .post('/sign', c => c.json({ todo: 'insert waiver_signatures' }, 501))

export default app
