import { Hono } from 'hono'
import { requirePermission } from '../../../middleware/require-permission'
import { ptRequestRoutes } from '../pt-request-routes'

// Instructor PT surface. Instructors see the pending requests they may act on —
// unbound ones, plus those bound to them — and pick up the ones they can run;
// the schedule service forces instructor_id = self. A request debited from a
// package bound to someone else is neither listed nor schedulable here. There is
// no approve/decline: scheduling is the implicit approval. See be-portal.md §3c.
//
// Every route here is the **Take PT bookings** Instructor Permission
// (be/docs/adr/0012), the queue read included: it names the members behind
// every unbound request. A PT session an admin schedules for the instructor is
// taught from the timetable and check-in desk, which this does not gate.
//
// The routes are written once for both portals (`../pt-request-routes.ts`; the
// Admin's mount is `../admin/pt-sessions.ts`), so the permission is not applied
// inside them. Each path has one line here, registered before the module, so
// the gate runs after the role gate and before any ownership check or body
// validation.
const takesPtBookings = requirePermission('take_pt_bookings')

export default new Hono()
  .on('GET', '/', takesPtBookings)
  .on('POST', '/manual', takesPtBookings)
  .on('GET', '/seat-candidates', takesPtBookings)
  .on('POST', '/sessions/:id/members', takesPtBookings)
  .on('DELETE', '/sessions/:id/members/:clientId', takesPtBookings)
  .on('POST', '/:id/schedule', takesPtBookings)
  .on('POST', '/:id/cancel', takesPtBookings)
  .route('/', ptRequestRoutes('instructor'))
