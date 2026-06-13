import { Hono } from 'hono'
import { requireRole } from '../../../middleware/require-role'

import schedule from './schedule'
import roster from './roster'
import checkIn from './check-in'
import ptRequests from './pt-requests'
import profile from './profile'

const app = new Hono()
  .use('*', requireRole('instructor', 'admin', 'superadmin'))
  .route('/schedule', schedule)
  .route('/', roster)
  .route('/check-in', checkIn)
  .route('/pt-requests', ptRequests)
  .route('/profile', profile)

export default app
