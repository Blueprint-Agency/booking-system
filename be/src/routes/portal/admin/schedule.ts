import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as timetable from '../../../services/schedule/timetable'
import * as classesSvc from '../../../services/schedule/classes'
import { getClassDetail, getPtSessionDetail } from '../../../services/schedule/detail'

const isoDate = z
  .string()
  .refine(v => !Number.isNaN(Date.parse(v)), { message: 'invalid iso datetime' })

const listQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum(['class', 'workshop', 'pt']).optional(),
  instructor_id: z.string().uuid().optional(),
  class_type_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
})

const createClassSchema = z
  .object({
    class_type_id: z.string().uuid(),
    instructor_id: z.string().uuid(),
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
    class_type_id: e.classTypeId,
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

function classRow(c: classesSvc.ClassRow) {
  return {
    id: c.id,
    class_type_id: c.classTypeId,
    instructor_id: c.instructorId,
    location_id: c.locationId,
    room_id: c.roomId,
    starts_at: c.startsAt.toISOString(),
    ends_at: c.endsAt.toISOString(),
    capacity_online: c.capacityOnline,
    capacity_waitlist: c.capacityWaitlist,
    capacity_buffer: c.capacityBuffer,
    credit_cost: c.creditCost,
    lifecycle: c.lifecycle,
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const entries = await timetable.listSchedule({
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      type: q.type,
      instructorId: q.instructor_id,
      classTypeId: q.class_type_id,
      locationId: q.location_id,
    })
    return c.json({ entries: entries.map(entryRow) })
  })
  .get('/classes/:id', zValidator('param', z.object({ id: z.string().uuid() })), async c => {
    const { id } = c.req.valid('param')
    const d = await getClassDetail(id)
    return c.json({
      id: d.id,
      lifecycle: d.lifecycle,
      starts_at: d.startsAt.toISOString(),
      ends_at: d.endsAt.toISOString(),
      class_type: d.classType,
      instructor: d.instructor,
      location: d.location,
      room: d.room,
      capacity_online: d.capacityOnline,
      capacity_waitlist: d.capacityWaitlist,
      capacity_buffer: d.capacityBuffer,
      credit_cost: d.creditCost,
      booked_count: d.bookedCount,
    })
  })
  .get('/pt/:id', zValidator('param', z.object({ id: z.string().uuid() })), async c => {
    const { id } = c.req.valid('param')
    const d = await getPtSessionDetail(id)
    return c.json({
      id: d.id,
      lifecycle: d.lifecycle,
      starts_at: d.startsAt.toISOString(),
      ends_at: d.endsAt.toISOString(),
      session_type: d.sessionType,
      instructor: d.instructor,
      location: d.location,
      capacity_online: d.capacityOnline,
      capacity_waitlist: d.capacityWaitlist,
      capacity_buffer: d.capacityBuffer,
      clients: d.clients,
    })
  })
  .post('/classes', zValidator('json', createClassSchema), async c => {
    const body = c.req.valid('json')
    const staffId = c.get('staffUserId')
    const row = await classesSvc.createClass({
      classTypeId: body.class_type_id,
      instructorId: body.instructor_id,
      locationId: body.location_id,
      roomId: body.room_id,
      startsAt: new Date(body.starts_at),
      endsAt: new Date(body.ends_at),
      capacityOnline: body.capacity_online,
      capacityWaitlist: body.capacity_waitlist,
      capacityBuffer: body.capacity_buffer,
      creditCost: body.credit_cost,
      createdByStaffId: staffId,
    })
    c.set('auditTarget' as any, { table: 'classes', id: row.id })
    return c.json(classRow(row), 201)
  })
  .patch('/classes/:id', c =>
    c.json({ todo: 'edit class — reject if material change with bookings' }, 501),
  )
  .post('/classes/:id/cancel', c => c.json({ todo: 'admin-cancel class' }, 501))
  .post('/workshops/:id/cancel', c =>
    c.json({ todo: 'admin-cancel workshop + refund fanout' }, 501),
  )

export default app
