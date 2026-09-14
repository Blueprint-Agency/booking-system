import { Hono } from 'hono'
import stripe from './stripe'

const app = new Hono().route('/', stripe)

export default app
