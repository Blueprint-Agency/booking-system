import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as timetable from '../../../services/schedule/timetable'
import * as classesSvc from '../../../services/schedule/classes'
import { getClassDetail, getPtSessionDetail } from '../../../services/schedule/detail'
import { cancelClass } from '../../../services/bookings/cancel-class'
import { cancelWorkshop } from '../../../services/workshops/cancel'

const isoDate = z
  .string()
  .refine(v => !Number.isNaN(Date.parse(v)), { message: 'invalid iso datetime' })

const listQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum(['class', 'workshop', 'pt', 'corporate']).optional(),
  instructor_id: z.string().uuid().optional(),
  class_type_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
})

const createClassSchema = z
  .object({
    class_type_id: z.string().uuid(),
    main_instructor_id: z.string().uuid(),
    supporting_instructor_ids: z.array(z.string().uuid()).default([]),
    location_id: z.string().uuid(),
    room_id: z.string().uuid(),
    starts_at: isoDate,
    ends_at: isoDate,
    capacity_online: z.number().int().min(0),
    capacity_waitlist: z.number().int().min(0).default(0),
    capacity_buffer: z.number().int().min(0).default(0),
    credit_cost: z.number().int().min(0),
    instructor_pay_sgd: z.number().min(0).optional(),
  })
  .refine(v => v.capacity_online + v.capacity_waitlist + v.capacity_buffer > 0, {
    message: 'capacity must be positive',
    path: ['capacity_online'],
  })
  .refine(v => new Date(v.ends_at) > new Date(v.starts_at), {
    message: 'ends_at must be after starts_at',
    path: ['ends_at'],
  })

const supportingInstructorSchema = z.object({
  instructor_id: z.string().uuid(),
  pay_sgd: z.number().min(0).nullable().optional(),
})

const updateClassSchema = z.object({
  class_type_id: z.string().uuid().optional(),
  main_instructor_id: z.string().uuid().optional(),
  // New shape (per-instructor pay). `supporting_instructor_ids` (bare id array,
  // pay defaults to null) is kept for back-compat until the frontend edit UI
  // task lands — only one of the two may be sent.
  supporting_instructors: z.array(supportingInstructorSchema).optional(),
  supporting_instructor_ids: z.array(z.string().uuid()).optional(),
  location_id: z.string().uuid().optional(),
  room_id: z.string().uuid().optional(),
  starts_at: isoDate.optional(),
  ends_at: isoDate.optional(),
  capacity_online: z.number().int().min(0).optional(),
  capacity_waitlist: z.number().int().min(0).optional(),
  capacity_buffer: z.number().int().min(0).optional(),
  credit_cost: z.number().int().min(0).optional(),
  instructor_pay_sgd: z.number().min(0).nullable().optional(),
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

async function classRow(c: classesSvc.ClassRow) {
  const supportingInstructors = await classesSvc.listSupportingInstructors(c.id)
  const supportingInstructorIds = supportingInstructors.map(s => s.instructorId)
  return {
    id: c.id,
    class_type_id: c.classTypeId,
    main_instructor_id: c.mainInstructorId,
    supporting_instructor_ids: supportingInstructorIds,
    supporting_instructors: supportingInstructors.map(s => ({
      instructor_id: s.instructorId,
      pay_sgd: s.paySgd,
    })),
    instructor_ids: [c.mainInstructorId, ...supportingInstructorIds],
    location_id: c.locationId,
    room_id: c.roomId,
    starts_at: c.startsAt.toISOString(),
    ends_at: c.endsAt.toISOString(),
    capacity_online: c.capacityOnline,
    capacity_waitlist: c.capacityWaitlist,
    capacity_buffer: c.capacityBuffer,
    credit_cost: c.creditCost,
    instructor_pay_sgd: c.instructorPaySgd == null ? null : Number(c.instructorPaySgd),
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
      difficulty: d.difficulty,
      instructor: d.instructor,
      main_instructor_id: d.mainInstructorId,
      supporting_instructor_ids: d.supportingInstructorIds,
      supporting_instructors: d.supportingInstructors,
      instructor_ids: [d.mainInstructorId, ...d.supportingInstructorIds],
      location: d.location,
      room: d.room,
      capacity_online: d.capacityOnline,
      capacity_waitlist: d.capacityWaitlist,
      capacity_buffer: d.capacityBuffer,
      credit_cost: d.creditCost,
      booked_count: d.bookedCount,
      attendees: d.attendees.map(a => ({
        booking_id: a.bookingId,
        client: a.client,
        package_kind: a.packageKind,
        credits_used: a.creditsUsed,
        check_in_state: a.checkInState,
        code: a.code,
      })),
      created_at: d.createdAt.toISOString(),
      scheduled_by: d.scheduledBy,
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
      main_instructor_id: d.mainInstructorId,
      supporting_instructor_ids: d.supportingInstructorIds,
      supporting_instructors: d.supportingInstructors,
      instructor_ids: [d.mainInstructorId, ...d.supportingInstructorIds],
      location: d.location,
      room: d.room,
      capacity_online: d.capacityOnline,
      capacity_waitlist: d.capacityWaitlist,
      capacity_buffer: d.capacityBuffer,
      clients: d.clients.map(cl => ({
        id: cl.id,
        name: cl.name,
        code: cl.code,
        check_in_state: cl.checkInState,
      })),
    })
  })
  .post('/classes', zValidator('json', createClassSchema), async c => {
    const body = c.req.valid('json')
    const staffId = c.get('staffUserId')
    const row = await classesSvc.createClass({
      classTypeId: body.class_type_id,
      mainInstructorId: body.main_instructor_id,
      supportingInstructorIds: body.supporting_instructor_ids,
      locationId: body.location_id,
      roomId: body.room_id,
      startsAt: new Date(body.starts_at),
      endsAt: new Date(body.ends_at),
      capacityOnline: body.capacity_online,
      capacityWaitlist: body.capacity_waitlist,
      capacityBuffer: body.capacity_buffer,
      creditCost: body.credit_cost,
      instructorPaySgd: body.instructor_pay_sgd ?? null,
      createdByStaffId: staffId,
    })
    c.set('auditTarget' as any, { table: 'classes', id: row.id })
    return c.json(await classRow(row), 201)
  })
  .patch(
    '/classes/:id',
    zValidator('param', z.object({ id: z.string().uuid() })),
    zValidator('json', updateClassSchema),
    async c => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      // Back-compat: bare `supporting_instructor_ids` (old shape, pay defaults
      // to null) still works alongside the new `supporting_instructors` shape.
      let supportingInstructors: classesSvc.SupportingInstructorInput[] | undefined
      if (body.supporting_instructors !== undefined) {
        supportingInstructors = body.supporting_instructors.map(s => ({
          instructorId: s.instructor_id,
          paySgd: s.pay_sgd ?? null,
        }))
      } else if (body.supporting_instructor_ids !== undefined) {
        supportingInstructors = body.supporting_instructor_ids.map(instructorId => ({
          instructorId,
          paySgd: null,
        }))
      }
      const row = await classesSvc.updateClass(id, {
        ...(body.class_type_id !== undefined ? { classTypeId: body.class_type_id } : {}),
        ...(body.main_instructor_id !== undefined
          ? { mainInstructorId: body.main_instructor_id }
          : {}),
        ...(supportingInstructors !== undefined ? { supportingInstructors } : {}),
        ...(body.location_id !== undefined ? { locationId: body.location_id } : {}),
        ...(body.room_id !== undefined ? { roomId: body.room_id } : {}),
        ...(body.starts_at !== undefined ? { startsAt: new Date(body.starts_at) } : {}),
        ...(body.ends_at !== undefined ? { endsAt: new Date(body.ends_at) } : {}),
        ...(body.capacity_online !== undefined ? { capacityOnline: body.capacity_online } : {}),
        ...(body.capacity_waitlist !== undefined
          ? { capacityWaitlist: body.capacity_waitlist }
          : {}),
        ...(body.capacity_buffer !== undefined ? { capacityBuffer: body.capacity_buffer } : {}),
        ...(body.credit_cost !== undefined ? { creditCost: body.credit_cost } : {}),
        ...(body.instructor_pay_sgd !== undefined
          ? { instructorPaySgd: body.instructor_pay_sgd }
          : {}),
      })
      c.set('auditTarget' as any, { table: 'classes', id })
      return c.json(await classRow(row))
    },
  )
  .post(
    '/classes/:id/cancel',
    zValidator('param', z.object({ id: z.string().uuid() })),
    async c => {
      const { id } = c.req.valid('param')
      const staffId = c.get('staffUserId')
      const res = await cancelClass({ classId: id, actorStaffId: staffId })
      c.set('auditTarget' as any, { table: 'classes', id })
      return c.json({ total_bookings: res.totalBookings, refunded_count: res.refundedCount })
    },
  )
  .post(
    '/workshops/:id/cancel',
    zValidator('param', z.object({ id: z.string().uuid() })),
    async c => {
      const { id } = c.req.valid('param')
      const staffId = c.get('staffUserId')
      await cancelWorkshop(id, staffId)
      c.set('auditTarget' as any, { table: 'workshops', id })
      return c.json({ ok: true })
    },
  )

export default app
