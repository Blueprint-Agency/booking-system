import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'list feature_flags' }, 501))
  .patch('/:key', c => c.json({ todo: 'toggle flag + invalidate cache' }, 501))

export default app
