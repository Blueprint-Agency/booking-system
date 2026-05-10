import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'list clients (search + status filter)' }, 501))
  .get('/:id', c => c.json({ todo: 'profile + packages + history + cancellation count + referrals' }, 501))
  .post('/:id/suspend', c => c.json({ todo: 'suspend + Clerk revokeAllSessions' }, 501))
  .post('/:id/unsuspend', c => c.json({ todo: 'unsuspend' }, 501))
  .post('/:id/credits/adjust', c => c.json({ todo: 'manual credit adjust — services/packages/adjust' }, 501))
  .post('/:id/sessions/adjust', c => c.json({ todo: 'manual session adjust' }, 501))
  .post('/:id/packages/issue', c => c.json({ todo: 'admin grants complimentary package' }, 501))

export default app
