import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as timetable from '../../../services/schedule/timetable'
import * as classesSvc from '../../../services/schedule/classes'

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

// Today's [from, to) window in Asia/Singapore (UTC+8, no DST) as UTC instants.
function sgtTodayRange(now: Date): { from: Date; to: Date } {
  const sgt = new Date(now.getTime() + 8 * 3600_000)
  const startUtc = new Date(
    Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate(), 0, 0, 0) - 8 * 3600_000,
  )
  return { from: startUtc, to: new Date(startUtc.getTime() + 24 * 3600_000) }
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
    const { from, to } = sgtTodayRange(new Date())
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

export default app
