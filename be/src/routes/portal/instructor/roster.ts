import { Hono } from 'hono'

const app = new Hono().get('/sessions/:kind/:id/roster', c =>
  c.json({ todo: 'own session roster — service guards ownership' }, 501),
)

export default app
