import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'all ratings with full attribution' }, 501))
  .get('/instructor/:id/aggregate', c => c.json({ todo: 'instructor aggregate average + count' }, 501))

export default app
