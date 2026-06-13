import { Hono } from 'hono'
import catalog from './catalog'
import marketing from './marketing'
import referral from './referral'
import staffInvitations from './staff-invitations'

const app = new Hono()
  .route('/', catalog)
  .route('/', marketing)
  .route('/', referral)
  .route('/', staffInvitations)

export default app
