import { Hono } from 'hono'
import { clientAuth, requireActiveClient } from '../../middleware/client-auth'
import { clientImpersonation } from '../../middleware/client-impersonation'
import { audit } from '../../middleware/audit'

import me from './me'
import catalog from './catalog'
import bookings from './bookings'
import ptSessions from './pt-sessions'
import purchases from './purchases'
import invoices from './invoices'
import waiver from './waiver'
import referral from './referral'

const app = new Hono()
  .use('*', clientAuth, requireActiveClient)
  .use('*', clientImpersonation, audit)
  .route('/', me)
  .route('/', catalog)
  .route('/bookings', bookings)
  .route('/pt-sessions', ptSessions)
  .route('/', purchases)
  .route('/invoices', invoices)
  .route('/waiver', waiver)
  .route('/referral', referral)

export default app
