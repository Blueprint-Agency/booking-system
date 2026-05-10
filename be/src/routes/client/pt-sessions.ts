import { Hono } from 'hono'
import { requireVerified } from '../../middleware/clerk-client'

const app = new Hono()
  .get('/', c => c.json({ todo: 'list own pt sessions' }, 501))
  .post('/request', requireVerified, c => c.json({ todo: 'submit PT request' }, 501))
  .delete('/:id', requireVerified, c => c.json({ todo: 'cancel pt request/booking' }, 501))

export default app
