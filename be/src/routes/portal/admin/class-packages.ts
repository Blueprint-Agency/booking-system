import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'list class_packages (?status)' }, 501))
  .post('/', c => c.json({ todo: 'create — CHECK enforces kind-specific cols' }, 501))
  .patch('/:id', c => c.json({ todo: 'update name/status only — price changes future-only' }, 501))
  .post('/:id/archive', c => c.json({ todo: 'archive; existing client_packages remain valid' }, 501))

export default app
