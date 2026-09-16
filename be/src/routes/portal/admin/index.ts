import { Hono } from 'hono'
import { requireRole } from '../../../middleware/require-role'

import locations from './locations'
import rooms from './rooms'
import classTypes from './class-types'
import instructors from './instructors'
import policy from './policy'
import classPackages from './class-packages'
import ptPackages from './pt-packages'
import corporatePackages from './corporate-packages'
import promoCodes from './promo-codes'
import workshops from './workshops'
import merch from './merch'
import schedule from './schedule'
import ptSessions from './pt-sessions'
import corporateSessions from './corporate-sessions'
import corporateRequests from './corporate-requests'
import bookings from './bookings'
import finance from './finance'
import leave from './leave'
import checkIn from './check-in'
import inbox from './inbox'
import clients from './clients'
import staff from './staff'
import notifications from './notifications'
import waiver from './waiver'
import marketing from './marketing'
import featureFlags from './feature-flags'
import impersonate from './impersonate'

/**
 * Role gating for the portal /admin subtree: a studio's admins run the whole
 * studio (#148), so every surface here takes the same gate. Instructors have
 * their own subtree and are refused all of this one.
 *
 * `superadmin` passes too until the role itself is removed (#150).
 */
const app = new Hono()
  .use('*', requireRole('superadmin', 'admin'))

  // ── Route mounts ────────────────────────────────────────────────────────
  .route('/locations', locations)
  .route('/rooms', rooms)
  .route('/class-types', classTypes)
  .route('/instructors', instructors)
  .route('/policy', policy)
  .route('/class-packages', classPackages)
  .route('/pt-packages', ptPackages)
  .route('/corporate-packages', corporatePackages)
  .route('/promo-codes', promoCodes)
  .route('/workshops', workshops)
  .route('/merch', merch)
  .route('/schedule', schedule)
  .route('/pt-sessions', ptSessions)
  .route('/corporate-sessions', corporateSessions)
  .route('/corporate-requests', corporateRequests)
  .route('/bookings', bookings)
  .route('/finance', finance)
  .route('/leave', leave)
  .route('/check-in', checkIn)
  .route('/inbox', inbox)
  .route('/clients', clients)
  .route('/', impersonate)
  .route('/staff', staff)
  .route('/notifications', notifications)
  .route('/waiver', waiver)
  .route('/marketing', marketing)
  .route('/feature-flags', featureFlags)

export default app
