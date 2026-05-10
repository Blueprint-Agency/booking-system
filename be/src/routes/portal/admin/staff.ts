import { Hono } from 'hono'
import { requireRole } from '../../../middleware/require-role'

const app = new Hono()
  .get('/', c => c.json({ todo: 'list staff_users + open invitations' }, 501))
  .post('/invite', c => c.json({ todo: 'create staff_invitation + Clerk invite' }, 501))
  .post('/invitations/:id/revoke', c => c.json({ todo: 'revoke invitation' }, 501))
  .post('/:id/archive', requireRole('superadmin'), c =>
    c.json({ todo: 'archive staff (superadmin only) + Clerk session revoke' }, 501),
  )

export default app
