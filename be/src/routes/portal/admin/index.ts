import { Hono } from 'hono'
import { requireRole } from '../../../middleware/require-role'
import { adminReadOnly } from '../../../middleware/admin-read-only'

import locations from './locations'
import rooms from './rooms'
import classTypes from './class-types'
import instructors from './instructors'
import policy from './policy'
import classPackages from './class-packages'
import ptPackages from './pt-packages'
import corporatePackages from './corporate-packages'
import workshops from './workshops'
import schedule from './schedule'
import availability from './availability'
import ptSessions from './pt-sessions'
import corporateSessions from './corporate-sessions'
import corporateRequests from './corporate-requests'
import bookings from './bookings'
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
 * Role gating for the portal /admin subtree.
 *
 * Three buckets, per docs/md/admin-restructure.md §1 & §14a:
 *
 *   1. Superadmin-only — global catalog + policy + governance. Admin role
 *      gets 403 on any method.
 *   2. Shared read/write — operations surfaces both roles drive.
 *   3. Admin read-only, superadmin full — admin can view but every non-GET
 *      method 403s for them (manual package adjustments, workshop CRUD, etc.).
 *
 * Path-prefix `.use()` runs before the matching route handler in Hono, so each
 * mount carries its own gate instead of relying on a single subtree-wide one.
 */

const superadminOnly = requireRole('superadmin')
const staffAny = requireRole('superadmin', 'admin')

const app = new Hono()
  // ── Superadmin-only (global catalog, policy, governance) ────────────────
  .use('/locations/*', superadminOnly)
  .use('/class-types/*', superadminOnly)
  .use('/instructors/*', superadminOnly)
  .use('/policy/*', superadminOnly)
  .use('/class-packages/*', superadminOnly)
  .use('/pt-packages/*', superadminOnly)
  .use('/corporate-packages/*', superadminOnly)
  .use('/corporate-sessions/*', superadminOnly)
  .use('/bookings/*', superadminOnly)
  .use('/staff/*', superadminOnly)
  .use('/notifications/*', superadminOnly)
  .use('/waiver/*', superadminOnly)
  .use('/marketing/*', superadminOnly)
  .use('/feature-flags/*', superadminOnly)
  // availability lives at `/instructors/:id/availability/...` so it's
  // covered by the instructors prefix gate below; we still mount it for
  // routing. Re-gate explicitly in case a future path moves out of the
  // `/instructors` tree.
  .use('/instructors/*', superadminOnly)

  // ── Shared read/write (workspace-scoped operations) ─────────────────────
  .use('/schedule/*', staffAny)
  .use('/pt-sessions/*', staffAny)
  // Corporate requests are driven from the schedule (staffAny), so both roles
  // operate the queue — unlike corporate-packages/-sessions (superadmin-only).
  .use('/corporate-requests/*', staffAny)
  .use('/check-in/*', staffAny)
  .use('/inbox/*', staffAny)

  // ── Admin read-only; superadmin full ────────────────────────────────────
  .use('/clients/*', staffAny, adminReadOnly)
  .use('/workshops/*', staffAny, adminReadOnly)
  .use('/rooms/*', staffAny, adminReadOnly)

  // ── Route mounts ────────────────────────────────────────────────────────
  .route('/locations', locations)
  .route('/rooms', rooms)
  .route('/class-types', classTypes)
  .route('/instructors', instructors)
  .route('/policy', policy)
  .route('/class-packages', classPackages)
  .route('/pt-packages', ptPackages)
  .route('/corporate-packages', corporatePackages)
  .route('/workshops', workshops)
  .route('/schedule', schedule)
  .route('/', availability)
  .route('/pt-sessions', ptSessions)
  .route('/corporate-sessions', corporateSessions)
  .route('/corporate-requests', corporateRequests)
  .route('/bookings', bookings)
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
