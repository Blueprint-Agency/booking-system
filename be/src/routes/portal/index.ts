import { Hono } from 'hono'
import { clerkStaffAuth, requireActiveStaff } from '../../middleware/clerk-staff'
import { impersonate } from '../../middleware/impersonate'
import { audit } from '../../middleware/audit'

import admin from './admin'
import instructor from './instructor'

const app = new Hono()
  .use('*', clerkStaffAuth, requireActiveStaff, impersonate, audit)
  .route('/admin', admin)
  .route('/instructor', instructor)

export default app
