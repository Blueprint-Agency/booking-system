import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'list pt_sessions (default ?status=pending)' }, 501))
  .post('/:id/approve', c => c.json({ todo: 'approve pt_session — see services/pt-sessions/approve' }, 501))
  .post('/:id/decline', c => c.json({ todo: 'decline with note' }, 501))
  .post('/:id/cancel', c => c.json({ todo: 'admin cancel — refund session count' }, 501))

export default app
