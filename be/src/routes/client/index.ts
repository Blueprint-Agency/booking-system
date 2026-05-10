import { Hono } from 'hono'
import { clerkClientAuth, requireActiveClient } from '../../middleware/clerk-client'

import me from './me'
import catalog from './catalog'
import bookings from './bookings'
import ptSessions from './pt-sessions'
import purchases from './purchases'
import invoices from './invoices'
import ratings from './ratings'
import waiver from './waiver'
import referral from './referral'

const app = new Hono()
  .use('*', clerkClientAuth, requireActiveClient)
  .route('/', me)
  .route('/', catalog)
  .route('/bookings', bookings)
  .route('/pt-sessions', ptSessions)
  .route('/', purchases)
  .route('/invoices', invoices)
  .route('/ratings', ratings)
  .route('/waiver', waiver)
  .route('/referral', referral)

export default app
