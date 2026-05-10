import { Hono } from 'hono'
import { requireRole } from '../../../middleware/require-role'

import locations from './locations'
import classTypes from './class-types'
import instructors from './instructors'
import policy from './policy'
import classPackages from './class-packages'
import ptPackages from './pt-packages'
import schedule from './schedule'
import availability from './availability'
import ptSessions from './pt-sessions'
import bookings from './bookings'
import checkIn from './check-in'
import inbox from './inbox'
import ratings from './ratings'
import clients from './clients'
import staff from './staff'
import notifications from './notifications'
import waiver from './waiver'
import marketing from './marketing'
import featureFlags from './feature-flags'

const app = new Hono()
  .use('*', requireRole('admin', 'superadmin'))
  .route('/locations', locations)
  .route('/class-types', classTypes)
  .route('/instructors', instructors)
  .route('/policy', policy)
  .route('/class-packages', classPackages)
  .route('/pt-packages', ptPackages)
  .route('/schedule', schedule)
  .route('/', availability)
  .route('/pt-sessions', ptSessions)
  .route('/bookings', bookings)
  .route('/check-in', checkIn)
  .route('/inbox', inbox)
  .route('/ratings', ratings)
  .route('/clients', clients)
  .route('/staff', staff)
  .route('/notifications', notifications)
  .route('/waiver', waiver)
  .route('/marketing', marketing)
  .route('/feature-flags', featureFlags)

export default app
