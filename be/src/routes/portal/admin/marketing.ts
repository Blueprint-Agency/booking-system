import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'singleton marketing_content' }, 501))
  .patch('/', c => c.json({ todo: 'edit hero / pricing / testimonials / footer' }, 501))

export default app
