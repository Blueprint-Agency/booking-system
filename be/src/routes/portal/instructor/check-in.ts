import { Hono } from 'hono'

const app = new Hono()
  .post('/scan', c => c.json({ todo: 'own session QR/code scan' }, 501))
  .post('/manual', c => c.json({ todo: 'own session manual tick' }, 501))

export default app
