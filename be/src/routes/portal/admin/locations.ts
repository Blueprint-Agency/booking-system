import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'list locations (?include_archived)' }, 501))
  .get('/:id', c => c.json({ todo: 'location detail' }, 501))
  .post('/', c => c.json({ todo: 'create location' }, 501))
  .patch('/:id', c => c.json({ todo: 'update location' }, 501))
  .post('/:id/archive', c => c.json({ todo: 'archive — block if active future sessions' }, 501))
  .post('/:id/unarchive', c => c.json({ todo: 'unarchive' }, 501))

export default app
