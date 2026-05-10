import { Hono } from 'hono'

const app = new Hono().get('/', c =>
  c.json({ todo: 'own recurring + one-off slots (read-only in v1; admin sets)' }, 501),
)

export default app
