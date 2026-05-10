import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'check-in candidates (ongoing + class-window)' }, 501))
  .post('/scan', c => c.json({ todo: 'verify QR/code, insert check_ins' }, 501))
  .post('/manual', c => c.json({ todo: 'admin manual tick' }, 501))

export default app
