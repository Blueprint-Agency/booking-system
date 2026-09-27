import { Hono } from 'hono'
import { requirePermission } from '../../../middleware/require-permission'
import { bookingCancelRoutes } from '../booking-cancel'

/**
 * An instructor cancels a member's booking on a class they lead (#320). The
 * factory is shared with the admin mount, so the **Manage rosters** Instructor
 * Permission (be/docs/adr/0012) is applied here, where the instructor subtree
 * mounts it, and registered before it so it runs first.
 */
export default new Hono()
  .use('/:id/cancel', requirePermission('manage_rosters'))
  .route('/', bookingCancelRoutes('instructor'))
