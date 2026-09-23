import { Hono } from 'hono'
import catalog from './catalog'
import marketing from './marketing'
import members from './members'
import referral from './referral'
import staffInvitations from './staff-invitations'
import staffSignIn from './staff-sign-in'
import tenants from './tenants'

const app = new Hono()
  .route('/', tenants)
  .route('/', catalog)
  .route('/', marketing)
  .route('/', members)
  .route('/', referral)
  .route('/', staffInvitations)
  .route('/', staffSignIn)

export default app
