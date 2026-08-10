import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as timetable from '../../../services/schedule/timetable'
import * as classesSvc from '../../../services/schedule/classes'
import { cancelClass } from '../../../services/bookings/cancel-class'
import { sgDayWindow, sgToday } from '../../../lib/time'

/**
 * Instructor schedule surface.
 *
 *   GET  /schedule        — the caller's own classes + PT (+ workshops/corporate
 *                           they're assigned to), optionally windowed by from/to.
 *   GET  /schedule/today  — same, narrowed to today (Asia/Singapore).
 *   POST /schedule/classes — create a class. The instructor and pay are NOT
 *                           accepted from the body: main_instructor_id is forced
 *                           to the acting instructor, there are no supporting
 *                           instructors, and instructor_pay_sgd is left null
 *                           (an admin prices it later from Payroll).
 *   POST /schedule/classes/:id/cancel — cancel a class the caller is the MAIN
 *                           instructor of, with a reason. Same service (and so
 *                           the same member refunds) as the admin path; the
 *                           main-instructor check lives in the service.
 */

const isoDate = z
  .string()
  .refine(v => !Number.isNaN(Date.parse(v)), { message: 'invalid iso datetime' })

const listQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum(['class', 'workshop', 'pt', 'corporate']).optional(),
})

const createClassSchema = z
  .object({
    class_type_id: z.string().uuid(),
    location_id: z.string().uuid(),
    room_id: z.string().uuid(),
    starts_at: isoDate,
    ends_at: isoDate,
    capacity_online: z.number().int().min(0),
    capacity_waitlist: z.number().int().min(0).default(0),
    capacity_buffer: z.number().int().min(0).default(0),
    credit_cost: z.number().int().min(0),
  })
  .refine(v => v.capacity_online + v.capacity_waitlist + v.capacity_buffer > 0, {
    message: 'capacity must be positive',
    path: ['capacity_online'],
  })
  .refine(v => new Date(v.ends_at) > new Date(v.starts_at), {
    message: 'ends_at must be after starts_at',
    path: ['ends_at'],
  })

function entryRow(e: timetable.ScheduleEntryRow) {
  return {
    kind: e.kind,
    id: e.id,
    workshop_id: e.workshopId,
    label: e.label,
    subtitle: e.subtitle ?? null,
    class_type_id: e.classTypeId,
    main_instructor_id: e.mainInstructorId,
    supporting_instructor_ids: e.supportingInstructorIds,
    instructor_ids: e.instructorIds,
    location_id: e.locationId,
    room_id: e.roomId,
    starts_at: e.startsAt,
    ends_at: e.endsAt,
    capacity: e.capacity,
    booked_count: e.bookedCount,
    event_state: e.eventState,
    day_index: e.dayIndex,
    day_count: e.dayCount,
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const self = c.get('staffUserId')
    const entries = await timetable.listSchedule({
      instructorId: self,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      type: q.type,
    })
    return c.json({ entries: entries.map(entryRow) })
  })
  .get('/today', async c => {
    const self = c.get('staffUserId')
    // Today's [from, to) window in studio time, as UTC instants.
    const { startsAt: from, endsAt: to } = sgDayWindow(sgToday(new Date()))
    const entries = await timetable.listSchedule({ instructorId: self, from, to })
    return c.json({ entries: entries.map(entryRow) })
  })
  .post('/classes', zValidator('json', createClassSchema), async c => {
    const body = c.req.valid('json')
    const self = c.get('staffUserId')
    const row = await classesSvc.createClass({
      classTypeId: body.class_type_id,
      mainInstructorId: self, // forced: instructors can only schedule themselves
      supportingInstructorIds: [], // instructors can't assign other instructors
      locationId: body.location_id,
      roomId: body.room_id,
      startsAt: new Date(body.starts_at),
      endsAt: new Date(body.ends_at),
      capacityOnline: body.capacity_online,
      capacityWaitlist: body.capacity_waitlist,
      capacityBuffer: body.capacity_buffer,
      creditCost: body.credit_cost,
      instructorPaySgd: null, // left unpriced; an admin sets pay from Payroll
      createdByStaffId: self,
    })
    c.set('auditTarget' as any, { table: 'classes', id: row.id })
    return c.json(
      {
        id: row.id,
        class_type_id: row.classTypeId,
        main_instructor_id: row.mainInstructorId,
        location_id: row.locationId,
        room_id: row.roomId,
        starts_at: row.startsAt.toISOString(),
        ends_at: row.endsAt.toISOString(),
        capacity_online: row.capacityOnline,
        capacity_waitlist: row.capacityWaitlist,
        capacity_buffer: row.capacityBuffer,
        credit_cost: row.creditCost,
        instructor_pay_sgd: null,
        lifecycle: row.lifecycle,
      },
      201,
    )
  })
  .post(
    '/classes/:id/cancel',
    zValidator('param', z.object({ id: z.string().uuid() })),
    zValidator('json', z.object({ reason: z.string().trim().min(1).max(500) })),
    async c => {
      const { id } = c.req.valid('param')
      const { reason } = c.req.valid('json')
      const res = await cancelClass({
        classId: id,
        actorStaffId: c.get('staffUserId'), // never from the body
        source: 'instructor',
        reason,
      })
      c.set('auditTarget' as any, { table: 'classes', id })
      return c.json({ total_bookings: res.totalBookings, refunded_count: res.refundedCount })
    },
  )

export default app
