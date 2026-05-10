import { Hono } from 'hono'
import { requireVerified } from '../../middleware/clerk-client'

const app = new Hono()
  .post('/checkout/package', requireVerified, c =>
    c.json({ todo: 'create Stripe Payment Intent for package' }, 501),
  )
  .post('/checkout/workshop', requireVerified, c =>
    c.json({ todo: 'create Stripe Payment Intent for workshop (free workshops bypass)' }, 501),
  )

export default app
