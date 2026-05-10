import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'list instructors' }, 501))
  .get('/:id', c => c.json({ todo: 'detail incl. eligibility + photo + ratings aggregate' }, 501))
  .post('/', c => c.json({ todo: 'create staff_users + instructors + eligibility + auto-invite' }, 501))
  .patch('/:id', c => c.json({ todo: 'update bio/phone/eligibility' }, 501))
  .post('/:id/archive', c => c.json({ todo: 'archive + Clerk revokeAllSessions' }, 501))
  .post('/:id/resend-invite', c => c.json({ todo: 're-issue invitation if pending' }, 501))

export default app
