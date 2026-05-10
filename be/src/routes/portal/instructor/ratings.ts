import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'own ratings — anonymized (no client attribution)' }, 501))
  .get('/aggregate', c => c.json({ todo: 'own average + count by month' }, 501))

export default app
