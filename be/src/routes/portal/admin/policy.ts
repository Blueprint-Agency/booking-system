import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'global_policy + pt_booking_config' }, 501))
  .patch('/global', c => c.json({ todo: 'update global_policy singleton' }, 501))
  .patch('/pt', c => c.json({ todo: 'update pt_booking_config singleton' }, 501))

export default app
