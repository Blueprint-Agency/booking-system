import { Hono } from 'hono'

const app = new Hono().get('/referral/by-code/:code', c =>
  c.json({ todo: 'resolve referral code at registration', code: c.req.param('code') }, 501),
)

export default app
