import { Hono } from 'hono'

const app = new Hono()
  .get('/', c => c.json({ todo: 'own instructors row + name from staff_users' }, 501))
  .patch('/', c => c.json({ todo: 'update bio/phone/photo (R2 presigned upload)' }, 501))

export default app
