import { Hono } from 'hono'

const app = new Hono().get('/marketing', c => c.json({ todo: 'singleton marketing_content row' }, 501))

export default app
