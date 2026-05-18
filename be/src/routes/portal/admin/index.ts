import { Hono } from 'hono'
import { requireRole } from '../../../middleware/require-role'

import locations from './locations'
import classTypes from './class-types'
import instructors from './instructors'
import policy from './policy'
import classPackages from './class-packages'
import ptPackages from './pt-packages'
import workshops from './workshops'
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

/**
 * v0 slice — superadmin-only. The admin role gains read access on Clients in
 * a later slice; the multi-role split is deferred until that surface lands.
 *
 * The 7 surfaces built in this slice (locations, class-types, instructors,
 * policy, class-packages, pt-packages, workshops) are wired below; everything
 * else stays mounted as 501 stubs for forward compatibility.
 */
const app = new Hono()
  .use('*', requireRole('superadmin'))
  .route('/locations', locations)
  .route('/class-types', classTypes)
  .route('/instructors', instructors)
  .route('/policy', policy)
  .route('/class-packages', classPackages)
  .route('/pt-packages', ptPackages)
  .route('/workshops', workshops)
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
