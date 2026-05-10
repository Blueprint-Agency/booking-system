import { Hono } from 'hono'

const app = new Hono()
  .get('/locations', c => c.json({ todo: 'list active locations' }, 501))
  .get('/classes', c => c.json({ todo: 'list classes (filter location/date/instructor/type)' }, 501))
  .get('/classes/:id', c => c.json({ todo: 'class detail' }, 501))
  .get('/workshops', c => c.json({ todo: 'list workshops (filter location/date)' }, 501))
  .get('/workshops/:id', c => c.json({ todo: 'workshop detail incl. tiers + images + instructors' }, 501))
  .get('/packages', c => c.json({ todo: 'list active class + pt packages' }, 501))

export default app
