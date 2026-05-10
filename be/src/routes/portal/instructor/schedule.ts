import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'own classes + confirmed pt + workshops' }, 501))
  .get('/today', c => c.json({ todo: 'own — today (SGT)' }, 501))

export default app
