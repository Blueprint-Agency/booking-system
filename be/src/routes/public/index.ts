import { Hono } from 'hono'
import catalog from './catalog'
import marketing from './marketing'
import referral from './referral'

const app = new Hono().route('/', catalog).route('/', marketing).route('/', referral)

export default app
