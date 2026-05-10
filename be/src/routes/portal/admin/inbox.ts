import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'list inbox_items (?type, ?read)' }, 501))
  .get('/unread-count', c => c.json({ todo: 'badge count' }, 501))
  .post('/:id/mark-read', c => c.json({ todo: 'set read_at' }, 501))
  .post('/:id/approve', c => c.json({ todo: 'approve pt_request — calls pt-sessions/approve service' }, 501))
  .post('/:id/decline', c => c.json({ todo: 'decline pt_request' }, 501))

export default app
