import { Hono } from 'hono'

const app = new Hono()
  .get('/templates', c => c.json({ todo: 'list 22 seeded templates' }, 501))
  .get('/templates/:slug', c => c.json({ todo: 'body + variable allow-list' }, 501))
  .patch('/templates/:slug', c =>
    c.json({ todo: 'update; reject unknown {{var}} (powers fe-portal §17c amber flag)' }, 501),
  )
  .get('/log', c => c.json({ todo: 'paginated email_log view' }, 501))

export default app
