import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as seriesSvc from '../../services/schedule/series'
import { packageRuleSchema, toPackageRule } from './class-package-rule'
import { namedRuleJson } from '../../services/schedule/package-rules'
import { tenantId } from '../../middleware/tenant'
import { explainInvalid } from '../explain-invalid'
import { plainDate } from '../../shared/plain-date'
import { type BodyOf, supportingInstructorSchema } from './parse'
import type { Surface } from './surface'

/**
 * A Class Series on the wire, shared by the admin and instructor schedule
 * routes (be/CONTEXT.md § Class Series). Both create a series by preview then
 * commit of one body; they differ only in who the instructors are and what they
 * are paid, which the admin sends and the instructor route fills in itself.
 * Shape only: what a series does is `services/schedule/series`.
 */

/** A series body refused for its shape, answered with the first field's sentence. */
export const explainSeries = explainInvalid('That series is not valid.')

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM')

/** Everything a series body carries except its instructors and their pay. */
const seriesTemplateFields =z.object({
  class_type_id: z.string().uuid(),
  location_id: z.string().uuid(),
  room_id: z.string().uuid(),
  weekday: z.number().int().min(1).max(7),
  start_time: localTime,
  end_time: localTime,
  capacity_online: z.number().int().min(0),
  capacity_waitlist: z.number().int().min(0).default(0),
  capacity_buffer: z.number().int().min(0).default(0),
  credit_cost: z.number().int().min(0),
  // Copied onto every class the series creates, extends included; omitted = accepts all.
  package_rule: packageRuleSchema.optional(),
  first_date: plainDate('A first date'),
  last_date: plainDate('A last date'),
  excluded_dates: z.array(plainDate('A skipped date')).default([]),
})

type TemplateBody = z.infer<typeof seriesTemplateFields>
type SeriesStaffing = Pick<
  seriesSvc.CreateSeriesInput,
  'mainInstructorId' | 'instructorPaySgd' | 'supportingInstructors'
>

/** A parsed series body plus who teaches it, as the service takes it. */
function toSeriesInput(b: TemplateBody, staffing: SeriesStaffing): seriesSvc.CreateSeriesInput {
  return {
    ...staffing,
    classTypeId: b.class_type_id,
    locationId: b.location_id,
    roomId: b.room_id,
    weekday: b.weekday as seriesSvc.SeriesTemplate['weekday'],
    startTime: b.start_time,
    endTime: b.end_time,
    capacityOnline: b.capacity_online,
    capacityWaitlist: b.capacity_waitlist,
    capacityBuffer: b.capacity_buffer,
    creditCost: b.credit_cost,
    ...(b.package_rule ? { packageRule: toPackageRule(b.package_rule) } : {}),
    firstDate: b.first_date,
    lastDate: b.last_date,
    excludedDates: b.excluded_dates,
  }
}

export function seriesRow(s: seriesSvc.SeriesDetail) {
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
    package_rule: namedRuleJson(s.packageRuleNamed),
    first_date: s.firstDate,
    last_date: s.lastDate,
    excluded_dates: s.excludedDates,
    ended_from: s.endedFrom,
    created_at: s.createdAt.toISOString(),
  }
}

export const previewJson = (dates: seriesSvc.PreviewDate[]) => ({
  dates: dates.map(seriesSvc.previewDateJson),
  clash_count: dates.filter(d => d.clashes.length > 0).length,
})

/**
 * Preview, then commit, one Class Series body (see services/schedule/series.ts),
 * mounted under `/schedule` by both portals. The surfaces differ in who teaches
 * and what they are paid, the same as for a single class:
 *
 *   admin       names the main instructor, the supporting ones and the pay
 *               (blank leaves every class of the series Unpriced for that
 *               instructor).
 *   instructor  none of that is accepted, so an Admin's fields sent here are
 *               dropped by the parse: the caller is the main instructor,
 *               nobody supports, and pay is null for an Admin to set from
 *               Finance. Extend and end stay Admin only.
 *
 *   POST /series/preview — the dates the series would make, and which clash
 *   POST /series         — create it
 */
function seriesCreateFor<Body extends TemplateBody>(spec: {
  body: BodyOf<Body>
  staffing: (b: Body, self: string) => SeriesStaffing
}) {
  return new Hono()
    .post('/series/preview', zValidator('json', spec.body, explainSeries), async c => {
      const body = c.req.valid('json')
      const input = toSeriesInput(body, spec.staffing(body, c.get('staffUserId')))
      return c.json(previewJson(await seriesSvc.previewSeries(tenantId(c), input)))
    })
    .post('/series', zValidator('json', spec.body, explainSeries), async c => {
      const body = c.req.valid('json')
      const self = c.get('staffUserId')
      const res = await seriesSvc.createSeries(tenantId(c), {
        ...toSeriesInput(body, spec.staffing(body, self)),
        createdByStaffId: self,
      })
      c.set('auditTarget', { table: 'class_series', id: res.series.id })
      return c.json({ series: seriesRow(res.series), class_ids: res.classIds }, 201)
    })
}

const surfaces: Record<Surface, Hono> = {
  admin: seriesCreateFor({
    body: seriesTemplateFields.extend({
      main_instructor_id: z.string().uuid(),
      // Optional, as on a single class: blank leaves every class of the series
      // Unpriced for that instructor.
      instructor_pay_sgd: z.number().min(0).nullable().optional(),
      supporting_instructors: z.array(supportingInstructorSchema).default([]),
    }),
    staffing: b => ({
      mainInstructorId: b.main_instructor_id,
      instructorPaySgd: b.instructor_pay_sgd ?? null,
      supportingInstructors: b.supporting_instructors.map(s => ({
        instructorId: s.instructor_id,
        paySgd: s.pay_sgd ?? null,
      })),
    }),
  }),
  instructor: seriesCreateFor({
    body: seriesTemplateFields,
    staffing: (_b, self) => ({
      mainInstructorId: self, // forced: instructors can only schedule themselves
      instructorPaySgd: null, // left unpriced; an admin sets pay from Finance
      supportingInstructors: [], // instructors can't assign other instructors
    }),
  }),
}

export const classSeriesCreateRoutes = (surface: Surface): Hono => surfaces[surface]
