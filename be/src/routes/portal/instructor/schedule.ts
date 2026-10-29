import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { cancelClass } from '../../../services/bookings/cancel-class'
import { tenantId } from '../../../middleware/tenant'
import { requirePermission } from '../../../middleware/require-permission'
import { classWaitlistRoutes } from '../class-waitlist'
import { classBookingRoutes } from '../class-booking'
import { classCreateRoutes } from '../class-create'
import { classSeriesCreateRoutes } from '../class-series'
import { idParam } from '../parse'
import { timetableRoutes } from '../timetable-read'

/**
 * Instructor schedule surface.
 *
 *   GET  /schedule        — the caller's own classes + PT (+ workshops/corporate
 *                           they're assigned to), optionally windowed by from/to.
 *   POST /schedule/classes — create a class. The instructor and pay are NOT
 *                           accepted from the body: main_instructor_id is forced
 *                           to the acting instructor, there are no supporting
 *                           instructors, and instructor_pay_sgd is left null
 *                           (an admin prices it later from Payroll).
 *   POST /schedule/series/preview, POST /schedule/series — a weekly repeat
 *                           (Class Series), preview then commit, the admin
 *                           contract with the same forcing as a single class:
 *                           the caller is the main instructor, nobody supports,
 *                           and pay is null. Extend and end stay admin only.
 *   GET  /schedule/classes/:id/packages — a member's class packages for a class
 *                           the caller is the MAIN instructor of, classified.
 *   POST /schedule/classes/:id/bookings — book a member onto a class the caller
 *                           is the MAIN instructor of, into a free online seat,
 *                           else a buffer seat, paid
 *                           by the package picked or the Default payer.
 *   POST /schedule/classes/:id/cancel — cancel a class the caller is the MAIN
 *                           instructor of, with a reason. Same service (and so
 *                           the same member refunds) as the admin path; the
 *                           main-instructor check lives in the service.
 *
 * Creating a class, previewing or creating a series, and cancelling a class are
 * the **Schedule classes** Instructor Permission (be/docs/adr/0012); booking a
 * member onto a class, reading their packages and the three waitlist actions
 * are **Manage rosters**. The timetable is neither: it is what an Instructor
 * teaches from.
 *
 * Most of these routes are written once for both portals (the Admin's mount is
 * `../admin/schedule.ts`), so no permission is applied inside them. Each gated
 * path has one line here, registered before the module that serves it, so the
 * gate runs after the role gate and before any ownership check or body
 * validation: an Instructor without the permission is refused
 * `403 forbidden_permission`, never told about ownership or a malformed body.
 */
const schedulesClasses = requirePermission('schedule_classes')
const managesRosters = requirePermission('manage_rosters')

const app = new Hono()
  .on('POST', '/classes', schedulesClasses)
  .on('POST', '/series/preview', schedulesClasses)
  .on('POST', '/series', schedulesClasses)
  .on('POST', '/classes/:id/cancel', schedulesClasses)
  .on('GET', '/classes/:id/packages', managesRosters)
  .on('POST', '/classes/:id/bookings', managesRosters)
  // `/*` matches the bare `/classes/:id/waitlist` (join) too.
  .use('/classes/:id/waitlist/*', managesRosters)
  // The class waitlist of a class the caller teaches: put a member in line,
  // Add to class (never an overbook), Remove (spec-waitlist.md §7).
  .route('/', classWaitlistRoutes('instructor'))
  .route('/', timetableRoutes('instructor'))
  .route('/', classCreateRoutes('instructor'))
  .route('/', classSeriesCreateRoutes('instructor'))
  // A member's packages for a class the caller teaches, and booking them onto it.
  .route('/', classBookingRoutes('instructor'))
  // Unlike the Admin's, a cancel here needs a reason, and is recorded as the instructor's.
  .post(
    '/classes/:id/cancel',
    zValidator('param', idParam),
    zValidator('json', z.object({ reason: z.string().trim().min(1).max(500) })),
    async c => {
      const { id } = c.req.valid('param')
      const { reason } = c.req.valid('json')
      const res = await cancelClass(tenantId(c), {
        classId: id,
        actorStaffId: c.get('staffUserId'), // never from the body
        source: 'instructor',
        reason,
      })
      c.set('auditTarget', { table: 'classes', id })
      return c.json({ total_bookings: res.totalBookings, refunded_count: res.refundedCount })
    },
  )

export default app
