import { Hono } from 'hono'
import { clerkStaffAuth } from '../../middleware/clerk-staff'
import { requireActiveStaff } from '../../middleware/require-active'
import { impersonate } from '../../middleware/impersonate'
import { audit } from '../../middleware/audit'

import auth from './auth'
import leaveCalendar from './leave-calendar'
import admin from './admin'
import instructor from './instructor'

/**
 * Portal mount tree:
 *
 *   /api/v1/portal/auth/*    — Clerk staff JWT + active gate only (no role gate)
 *   /api/v1/portal/leave-calendar — same: every staff member sees who is away
 *   /api/v1/portal/admin/*   — auth + active + admin/superadmin role
 *   /api/v1/portal/instructor/* — auth + active + instructor/admin/superadmin role
 *
 * All branches share clerkStaffAuth + requireActiveStaff. Impersonate + audit
 * apply only to the admin / instructor branches (auth/me is a pure read of the
 * caller's own row and doesn't need an audit row).
 */
const app = new Hono()
  .use('*', clerkStaffAuth, requireActiveStaff)
  .route('/auth', auth)
  .route('/leave-calendar', leaveCalendar)
  .use('/admin/*', impersonate, audit)
  .use('/instructor/*', impersonate, audit)
  .route('/admin', admin)
  .route('/instructor', instructor)

export default app
