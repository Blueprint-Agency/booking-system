import { Hono } from 'hono'
import catalog from './catalog'
import marketing from './marketing'
import referral from './referral'
import staffInvitations from './staff-invitations'
import tenants from './tenants'

const app = new Hono()
  .route('/', tenants)
  .route('/', catalog)
  .route('/', marketing)
  .route('/', referral)
  .route('/', staffInvitations)

export default app
