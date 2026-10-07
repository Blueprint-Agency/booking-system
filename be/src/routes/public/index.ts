import { Hono } from 'hono'
import catalog from './catalog'
import marketing from './marketing'
import members from './members'
import referral from './referral'
import staffEmailChange from './staff-email-change'
import staffInvitations from './staff-invitations'
import staffSignIn from './staff-sign-in'
import tenants from './tenants'

const app = new Hono()
  .route('/', tenants)
  .route('/', catalog)
  .route('/', marketing)
  .route('/', members)
  .route('/', referral)
  .route('/', staffEmailChange)
  .route('/', staffInvitations)
  .route('/', staffSignIn)
  // What the frontends' maintenance screen re-checks: while maintenance is on
  // the gate in app.ts answers it 503, so reaching here means it is off.
  .get('/maintenance', c => c.json({ maintenance: false }))

export default app
