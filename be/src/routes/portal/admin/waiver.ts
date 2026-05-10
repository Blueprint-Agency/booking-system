import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'singleton waiver + signed count' }, 501))
  .patch('/', c => c.json({ todo: 'replace body_html (no versioning)' }, 501))

export default app
