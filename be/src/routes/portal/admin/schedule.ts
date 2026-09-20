import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as timetable from '../../../services/schedule/timetable'
import * as classesSvc from '../../../services/schedule/classes'
import * as seriesSvc from '../../../services/schedule/series'
import { getClassDetail, getPtSessionDetail } from '../../../services/schedule/detail'
import { cancelClass } from '../../../services/bookings/cancel-class'
import { cancelWorkshop } from '../../../services/workshops/cancel'
import { workshopRow } from './workshops'
import { tenantId } from '../../../middleware/tenant'

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

const supportingInstructorSchema = z.object({
  instructor_id: z.string().uuid(),
  pay_sgd: z.number().min(0).nullable().optional(),
})

/**
 * snake_case → the roster module's shape, and nothing else. An OMITTED `pay_sgd`
 * stays omitted (the roster keeps whatever is recorded); an explicit `null`
 * stays null (unpriced). What either means is the roster module's business —
 * see services/schedule/roster-merge.ts.
 */
function toAssignments(
  supporting: z.infer<typeof supportingInstructorSchema>[],
): classesSvc.RosterAssignment[] {
  return supporting.map(s => ({
    instructorId: s.instructor_id,
    ...(s.pay_sgd !== undefined ? { paySgd: s.pay_sgd } : {}),
  }))
}

const createClassSchema = z
  .object({
    class_type_id: z.string().uuid(),
    main_instructor_id: z.string().uuid(),
    // New shape (per-instructor pay). `supporting_instructor_ids` (bare id array)
    // is kept for back-compat and means "these are the instructors, leave pay
    // alone" — send only one of the two; `supporting_instructors` wins.
    supporting_instructors: z.array(supportingInstructorSchema).optional(),
    supporting_instructor_ids: z.array(z.string().uuid()).optional(),
    location_id: z.string().uuid(),
    room_id: z.string().uuid(),
    starts_at: isoDate,
    ends_at: isoDate,
    capacity_online: z.number().int().min(0),
    capacity_waitlist: z.number().int().min(0).default(0),
    capacity_buffer: z.number().int().min(0).default(0),
    credit_cost: z.number().int().min(0),
    // Required on the ADMIN path only. An instructor scheduling their own class
    // creates it Unpriced — they must never see pay rates — and an admin prices
    // it later from Finance's "Needs pay" filter. See
    // be/docs/adr/0002-finance-replaces-payroll.md.
    instructor_pay_sgd: z.number().min(0),
  })
  .refine(v => v.capacity_online + v.capacity_waitlist + v.capacity_buffer > 0, {
    message: 'capacity must be positive',
    path: ['capacity_online'],
  })
  .refine(v => new Date(v.ends_at) > new Date(v.starts_at), {
    message: 'ends_at must be after starts_at',
    path: ['ends_at'],
  })

const updateClassSchema = z.object({
  class_type_id: z.string().uuid().optional(),
  main_instructor_id: z.string().uuid().optional(),
  // New shape (per-instructor pay). `supporting_instructor_ids` (bare id array)
  // is kept for back-compat and means "these are the instructors, leave pay
  // alone" — send only one of the two; `supporting_instructors` wins.
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

const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM')

const seriesSchema = z
  .object({
    class_type_id: z.string().uuid(),
    main_instructor_id: z.string().uuid(),
    instructor_pay_sgd: z.number().min(0),
    supporting_instructors: z
      .array(z.object({ instructor_id: z.string().uuid(), pay_sgd: z.number().min(0) }))
      .default([]),
    location_id: z.string().uuid(),
    room_id: z.string().uuid(),
    weekday: z.number().int().min(1).max(7),
    start_time: localTime,
    end_time: localTime,
    capacity_online: z.number().int().min(0),
    capacity_waitlist: z.number().int().min(0).default(0),
    capacity_buffer: z.number().int().min(0).default(0),
    credit_cost: z.number().int().min(0),
    first_date: plainDate,
    last_date: plainDate,
    excluded_dates: z.array(plainDate).default([]),
  })
  .refine(v => v.capacity_online + v.capacity_waitlist + v.capacity_buffer > 0, {
    message: 'capacity must be positive',
    path: ['capacity_online'],
  })

const extendSchema = z.object({
  last_date: plainDate,
  excluded_dates: z.array(plainDate).default([]),
})

const endSchema = z.object({ from_date: plainDate })

function toSeriesInput(b: z.infer<typeof seriesSchema>): seriesSvc.CreateSeriesInput {
  return {
    classTypeId: b.class_type_id,
    mainInstructorId: b.main_instructor_id,
    instructorPaySgd: b.instructor_pay_sgd,
    supportingInstructors: b.supporting_instructors.map(s => ({
      instructorId: s.instructor_id,
      paySgd: s.pay_sgd,
    })),
    locationId: b.location_id,
    roomId: b.room_id,
    weekday: b.weekday as seriesSvc.SeriesTemplate['weekday'],
    startTime: b.start_time,
    endTime: b.end_time,
    capacityOnline: b.capacity_online,
    capacityWaitlist: b.capacity_waitlist,
    capacityBuffer: b.capacity_buffer,
    creditCost: b.credit_cost,
    firstDate: b.first_date,
    lastDate: b.last_date,
    excludedDates: b.excluded_dates,
  }
}

function seriesRow(s: seriesSvc.SeriesDetail) {
  return {
    id: s.id,
    class_type_id: s.classTypeId,
    main_instructor_id: s.mainInstructorId,
    instructor_pay_sgd: s.instructorPaySgd,
    supporting_instructors: s.supportingInstructors.map(i => ({
      instructor_id: i.instructorId,
      pay_sgd: i.paySgd,
    })),
    location_id: s.locationId,
    room_id: s.roomId,
    weekday: s.weekday,
    start_time: s.startTime,
    end_time: s.endTime,
    capacity_online: s.capacityOnline,
    capacity_waitlist: s.capacityWaitlist,
    capacity_buffer: s.capacityBuffer,
    credit_cost: s.creditCost,
    first_date: s.firstDate,
    last_date: s.lastDate,
    excluded_dates: s.excludedDates,
    ended_from: s.endedFrom,
    created_at: s.createdAt.toISOString(),
  }
}

const previewJson = (dates: seriesSvc.PreviewDate[]) => ({
  dates: dates.map(seriesSvc.previewDateJson),
  clash_count: dates.filter(d => d.clashes.length > 0).length,
})

const seriesParam = zValidator('param', z.object({ id: z.string().uuid() }))

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
    series_id: e.seriesId,
  }
}

async function classRow(tenant: string, c: classesSvc.ClassRow) {
  const supportingInstructors = await classesSvc.listSupportingInstructors(tenant, c.id)
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
    series_id: c.seriesId,
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const entries = await timetable.listSchedule(tenantId(c), {
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
    const d = await getClassDetail(tenantId(c), id)
    return c.json({
      id: d.id,
      lifecycle: d.lifecycle,
      starts_at: d.startsAt.toISOString(),
      ends_at: d.endsAt.toISOString(),
      class_type: d.classType,
      difficulty: d.difficulty,
      instructor: d.instructor,
      main_instructor_id: d.mainInstructorId,
      instructor_pay_sgd: d.instructorPaySgd,
      supporting_instructor_ids: d.supportingInstructorIds,
      supporting_instructors: d.supportingInstructors.map(s => ({
        id: s.id,
        name: s.name,
        pay_sgd: s.paySgd,
      })),
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
      series_id: d.seriesId,
    })
  })
  .get('/pt/:id', zValidator('param', z.object({ id: z.string().uuid() })), async c => {
    const { id } = c.req.valid('param')
    const d = await getPtSessionDetail(tenantId(c), id)
    return c.json({
      id: d.id,
      pt_request_id: d.ptRequestId,
      lifecycle: d.lifecycle,
      starts_at: d.startsAt.toISOString(),
      ends_at: d.endsAt.toISOString(),
      session_type: d.sessionType,
      instructor: d.instructor,
      main_instructor_id: d.mainInstructorId,
      instructor_pay_sgd: d.instructorPaySgd,
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
    const row = await classesSvc.createClass(tenantId(c), {
      classTypeId: body.class_type_id,
      mainInstructorId: body.main_instructor_id,
      ...(body.supporting_instructors !== undefined
        ? { supportingInstructors: toAssignments(body.supporting_instructors) }
        : {}),
      ...(body.supporting_instructor_ids !== undefined
        ? { supportingInstructorIds: body.supporting_instructor_ids }
        : {}),
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
    return c.json(await classRow(tenantId(c), row), 201)
  })
  .patch(
    '/classes/:id',
    zValidator('param', z.object({ id: z.string().uuid() })),
    zValidator('json', updateClassSchema),
    async c => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const row = await classesSvc.updateClass(tenantId(c), id, {
        ...(body.class_type_id !== undefined ? { classTypeId: body.class_type_id } : {}),
        ...(body.main_instructor_id !== undefined
          ? { mainInstructorId: body.main_instructor_id }
          : {}),
        ...(body.supporting_instructors !== undefined
          ? { supportingInstructors: toAssignments(body.supporting_instructors) }
          : {}),
        ...(body.supporting_instructor_ids !== undefined
          ? { supportingInstructorIds: body.supporting_instructor_ids }
          : {}),
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
      return c.json(await classRow(tenantId(c), row))
    },
  )
  .post(
    '/classes/:id/cancel',
    zValidator('param', z.object({ id: z.string().uuid() })),
    async c => {
      const { id } = c.req.valid('param')
      const staffId = c.get('staffUserId')
      const res = await cancelClass(tenantId(c), { classId: id, actorStaffId: staffId })
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
      const w = await cancelWorkshop(tenantId(c), id, staffId, c.get('staffRow').role)
      c.set('auditTarget' as any, { table: 'workshops', id })
      // Same serializer as POST /admin/workshops/:id/cancel: one cancellation,
      // one response shape, whichever path reached it.
      return c.json(workshopRow(w))
    },
  )
  // ── Class Series ── preview, then commit the same input; see services/schedule/series.ts.
  .post('/series/preview', zValidator('json', seriesSchema), async c => {
    const dates = await seriesSvc.previewSeries(tenantId(c), toSeriesInput(c.req.valid('json')))
    return c.json(previewJson(dates))
  })
  .post('/series', zValidator('json', seriesSchema), async c => {
    const res = await seriesSvc.createSeries(tenantId(c), {
      ...toSeriesInput(c.req.valid('json')),
      createdByStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'class_series', id: res.series.id })
    return c.json({ series: seriesRow(res.series), class_ids: res.classIds }, 201)
  })
  .get('/series/:id', seriesParam, async c => {
    const { id } = c.req.valid('param')
    return c.json(seriesRow(await seriesSvc.getSeries(tenantId(c), id)))
  })
  .post('/series/:id/extend/preview', seriesParam, zValidator('json', extendSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const dates = await seriesSvc.previewExtend(tenantId(c), id, {
      lastDate: body.last_date,
      excludedDates: body.excluded_dates,
    })
    return c.json(previewJson(dates))
  })
  .post('/series/:id/extend', seriesParam, zValidator('json', extendSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const res = await seriesSvc.extendSeries(tenantId(c), id, {
      lastDate: body.last_date,
      excludedDates: body.excluded_dates,
      actorStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'class_series', id })
    return c.json({ series: seriesRow(res.series), class_ids: res.classIds })
  })
  .post('/series/:id/end', seriesParam, zValidator('json', endSchema), async c => {
    const { id } = c.req.valid('param')
    const res = await seriesSvc.endSeries(tenantId(c), id, {
      fromDate: c.req.valid('json').from_date,
      actorStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'class_series', id })
    return c.json({
      ended_from: res.endedFrom,
      cancelled_class_ids: res.cancelledClassIds,
      booked_classes: res.bookedClasses.map(b => ({
        class_id: b.classId,
        starts_at: b.startsAt.toISOString(),
        booked_count: b.bookedCount,
      })),
    })
  })

export default app
