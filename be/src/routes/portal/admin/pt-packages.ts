import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'list pt_packages' }, 501))
  .post('/', c => c.json({ todo: 'create' }, 501))
  .patch('/:id', c => c.json({ todo: 'update' }, 501))
  .post('/:id/archive', c => c.json({ todo: 'archive' }, 501))

export default app
