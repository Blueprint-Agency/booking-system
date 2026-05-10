import { Hono } from 'hono'
import clerk from './clerk'
import stripe from './stripe'

const app = new Hono().route('/', clerk).route('/', stripe)

export default app
