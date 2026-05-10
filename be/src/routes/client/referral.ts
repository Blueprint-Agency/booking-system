import { Hono } from 'hono'

const app = new Hono().get('/', c => c.json({ todo: 'own referral code + conversion stats' }, 501))

export default app
