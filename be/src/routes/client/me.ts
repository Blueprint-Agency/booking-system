import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'own profile' }, 501))
  .patch('/', c => c.json({ todo: 'update name/phone/gender/dob' }, 501))
  .get('/dashboard', c => c.json({ todo: 'next-up + balances' }, 501))
  .get('/packages', c => c.json({ todo: 'list own client_packages' }, 501))

export default app
