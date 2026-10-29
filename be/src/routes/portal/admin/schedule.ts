import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as classesSvc from '../../../services/schedule/classes'
import * as seriesSvc from '../../../services/schedule/series'
import { getClassDetail, getPtSessionDetail } from '../../../services/schedule/detail'
import { cancelClass } from '../../../services/bookings/cancel-class'
import { cancelWorkshop } from '../../../services/workshops/cancel'
import { workshopRow } from './workshops'
import { tenantId } from '../../../middleware/tenant'
import { classWaitlistRoutes } from '../class-waitlist'
import { classBookingRoutes } from '../class-booking'
import { classCreateRoutes, adminClassJson } from '../class-create'
import { classDetailJson } from '../class-detail'
import { packageRuleSchema, toPackageRule } from '../class-package-rule'
import { ptSessionDetailJson } from '../pt-session-detail'
import { plainDate } from '../../../shared/plain-date'
import { classSeriesCreateRoutes, explainSeries, previewJson, seriesRow } from '../class-series'
import { dateTime } from '../../../shared/date-time'
import { idParam, supportingInstructorSchema, toAssignments } from '../parse'
import { timetableRoutes } from '../timetable-read'

/**
 * The Admin's schedule: the whole studio's timetable, classes, Class Series,
 * workshop cancel and the waitlist. Gated by role alone (`../admin/index.ts`).
 *
 * Most of what an Admin does here an Instructor does too, on a narrower footing.
 * Those routes are written once, with the surface named where they mount (the
 * Instructor's mount is `../instructor/schedule.ts`, where each carries its
 * Instructor Permission). What stays in this file only an Admin may do: the class
 * and private session detail, editing a class, cancelling a class (no body: an
 * Instructor's needs a reason), cancelling a workshop, and reading, extending,
 * ending and setting the Package rule of a Class Series.
 */

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
  starts_at: dateTime('A start time').optional(),
  ends_at: dateTime('An end time').optional(),
  capacity_online: z.number().int().min(0).optional(),
  capacity_waitlist: z.number().int().min(0).optional(),
  capacity_buffer: z.number().int().min(0).optional(),
  credit_cost: z.number().int().min(0).optional(),
  instructor_pay_sgd: z.number().min(0).nullable().optional(),
  // Omitted = unchanged. Saving one cancels the bookings paid by a package it
  // no longer accepts, so the portal previews first.
  package_rule: packageRuleSchema.optional(),
  // Set: nothing is saved, and the answer is `{ would_cancel: n }` for the
  // `package_rule` sent.
  preview: z.boolean().optional(),
})

const extendSchema = z.object({
  last_date: plainDate('A last date'),
  excluded_dates: z.array(plainDate('A skipped date')).default([]),
})

const endSchema = z.object({ from_date: plainDate('An end date') })

const seriesParam = zValidator('param', idParam)

const app = new Hono()
  // The class waitlist: put a member in line, Add to class, Remove (spec-waitlist.md §7).
  .route('/', classWaitlistRoutes('admin'))
  .route('/', timetableRoutes('admin'))
  .get('/classes/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    return c.json(classDetailJson(await getClassDetail(tenantId(c), id), { admin: true }))
  })
  .get('/pt/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    return c.json(ptSessionDetailJson(await getPtSessionDetail(tenantId(c), id), { admin: true }))
  })
  // The member's class packages for a class, and booking them onto it.
  .route('/', classBookingRoutes('admin'))
  .route('/', classCreateRoutes('admin'))
  .patch('/classes/:id', zValidator('param', idParam), zValidator('json', updateClassSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    if (body.preview) {
      const wouldCancel = body.package_rule
        ? await classesSvc.previewClassRuleChange(tenantId(c), id, toPackageRule(body.package_rule))
        : 0
      return c.json({ would_cancel: wouldCancel })
    }
    const patch: classesSvc.UpdateClassInput = {
      ...(body.class_type_id !== undefined ? { classTypeId: body.class_type_id } : {}),
      ...(body.main_instructor_id !== undefined ? { mainInstructorId: body.main_instructor_id } : {}),
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
      ...(body.capacity_waitlist !== undefined ? { capacityWaitlist: body.capacity_waitlist } : {}),
      ...(body.capacity_buffer !== undefined ? { capacityBuffer: body.capacity_buffer } : {}),
      ...(body.credit_cost !== undefined ? { creditCost: body.credit_cost } : {}),
      ...(body.instructor_pay_sgd !== undefined ? { instructorPaySgd: body.instructor_pay_sgd } : {}),
      ...(body.package_rule !== undefined ? { packageRule: toPackageRule(body.package_rule) } : {}),
    }
    const row = await classesSvc.updateClass(tenantId(c), id, patch, c.get('staffUserId'))
    c.set('auditTarget', { table: 'classes', id })
    return c.json(await adminClassJson(tenantId(c), row))
  })
  .post('/classes/:id/cancel', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const staffId = c.get('staffUserId')
    const res = await cancelClass(tenantId(c), { classId: id, actorStaffId: staffId })
    c.set('auditTarget', { table: 'classes', id })
    return c.json({ total_bookings: res.totalBookings, refunded_count: res.refundedCount })
  })
  .post('/workshops/:id/cancel', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const staffId = c.get('staffUserId')
    const w = await cancelWorkshop(tenantId(c), id, staffId, c.get('staffRow').role)
    c.set('auditTarget', { table: 'workshops', id })
    // Same serializer as POST /admin/workshops/:id/cancel: one cancellation,
    // one response shape, whichever path reached it.
    return c.json(workshopRow(w))
  })
  // ── Class Series ── preview, then commit the same input; see services/schedule/series.ts.
  .route('/', classSeriesCreateRoutes('admin'))
  .get('/series/:id', seriesParam, async c => {
    const { id } = c.req.valid('param')
    return c.json(seriesRow(await seriesSvc.getSeries(tenantId(c), id)))
  })
  .post('/series/:id/extend/preview', seriesParam, zValidator('json', extendSchema, explainSeries), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const dates = await seriesSvc.previewExtend(tenantId(c), id, {
      lastDate: body.last_date,
      excludedDates: body.excluded_dates,
    })
    return c.json(previewJson(dates))
  })
  .post('/series/:id/extend', seriesParam, zValidator('json', extendSchema, explainSeries), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const res = await seriesSvc.extendSeries(tenantId(c), id, {
      lastDate: body.last_date,
      excludedDates: body.excluded_dates,
      actorStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget', { table: 'class_series', id })
    return c.json({ series: seriesRow(res.series), class_ids: res.classIds })
  })
  // The rule every class the series makes from now on is given; its existing
  // classes keep theirs (services/schedule/series.ts: setSeriesRule).
  .put('/series/:id/package-rule', seriesParam, zValidator('json', packageRuleSchema), async c => {
    const { id } = c.req.valid('param')
    const series = await seriesSvc.setSeriesRule(tenantId(c), id, toPackageRule(c.req.valid('json')))
    c.set('auditTarget', { table: 'class_series', id })
    return c.json(seriesRow(series))
  })
  .post('/series/:id/end', seriesParam, zValidator('json', endSchema, explainSeries), async c => {
    const { id } = c.req.valid('param')
    const res = await seriesSvc.endSeries(tenantId(c), id, {
      fromDate: c.req.valid('json').from_date,
      actorStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget', { table: 'class_series', id })
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
