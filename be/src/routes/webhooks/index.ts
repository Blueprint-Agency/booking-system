import { Hono } from 'hono'
import stripe from './stripe'
import resend from './resend'

const app = new Hono().route('/', stripe).route('/', resend)

export default app
