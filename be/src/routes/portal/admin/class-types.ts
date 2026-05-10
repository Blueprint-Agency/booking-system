import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'list class types' }, 501))
  .post('/', c => c.json({ todo: 'create' }, 501))
  .patch('/:id', c => c.json({ todo: 'update' }, 501))
  .post('/:id/archive', c => c.json({ todo: 'archive — block if any non-archived eligibility/active future references' }, 501))
  .post('/:id/unarchive', c => c.json({ todo: 'unarchive' }, 501))

export default app
