import { Hono } from 'hono'
import { clientAuth, requireActiveClient } from '../../middleware/client-auth'
import { clientImpersonation } from '../../middleware/client-impersonation'
import { audit } from '../../middleware/audit'
import { checkoutRateLimit } from '../../middleware/checkout-rate-limit'

import me from './me'
import catalog from './catalog'
import bookings from './bookings'
import ptSessions from './pt-sessions'
import purchases from './purchases'
import invoices from './invoices'
import waiver from './waiver'
import referral from './referral'
import waitlist from './waitlist'

const app = new Hono()
  .use('*', clientAuth, requireActiveClient)
  .use('*', clientImpersonation, audit)
  .use('/checkout/*', checkoutRateLimit)
  .route('/', me)
  .route('/', catalog)
  .route('/bookings', bookings)
  .route('/pt-sessions', ptSessions)
  .route('/', purchases)
  .route('/invoices', invoices)
  .route('/waiver', waiver)
  .route('/referral', referral)
  .route('/waitlist', waitlist)

export default app
