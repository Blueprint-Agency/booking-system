import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as classesSvc from '../../services/schedule/classes'
import { tenantId } from '../../middleware/tenant'
import { dateTime } from '../../shared/date-time'
import { classPackageRuleJson, packageRuleSchema, toPackageRule } from './class-package-rule'
import { type BodyOf, endsAfterStart, endsAfterStartIssue, supportingInstructorSchema, toAssignments } from './parse'
import type { Surface } from './surface'

/**
 * A class as the Admin's create and edit answer it: the whole row, with the
 * supporting instructors and what each is paid.
 */
export async function adminClassJson(tenant: string, c: classesSvc.ClassRow) {
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
    package_rule: await classPackageRuleJson(tenant, c),
    lifecycle: c.lifecycle,
    series_id: c.seriesId,
  }
}

/**
 * A class as the Instructor's create answers it: the row without its other
 * instructors, its series, or any pay (it is always Unpriced).
 */
async function instructorClassJson(tenant: string, row: classesSvc.ClassRow) {
  return {
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
    package_rule: await classPackageRuleJson(tenant, row),
    lifecycle: row.lifecycle,
  }
}

/**
 * The fields of a new class that are the same for both surfaces, in the order a
 * body is read. Each surface's own go between them (`staffing` after the class
 * type, `pay` after the cost), where the Admin's body carries them.
 */
const classType = { class_type_id: z.string().uuid() }
const placeAndSeats = {
  location_id: z.string().uuid(),
  room_id: z.string().uuid(),
  starts_at: dateTime('A start time'),
  ends_at: dateTime('An end time'),
  capacity_online: z.number().int().min(0),
  capacity_waitlist: z.number().int().min(0).default(0),
  capacity_buffer: z.number().int().min(0).default(0),
  credit_cost: z.number().int().min(0),
}
// Omitted = accepts all.
const rule = { package_rule: packageRuleSchema.optional() }

type Staffing = Pick<
  classesSvc.CreateClassInput,
  'mainInstructorId' | 'supportingInstructors' | 'supportingInstructorIds' | 'instructorPaySgd'
>

/**
 * `POST /classes` — create a class. What the body may say about who teaches it
 * and what they are paid is the surface's:
 *
 *   admin       names the main instructor and the supporting ones, and may
 *               price the class (blank leaves it Unpriced, be ADR 0008).
 *               Answers the whole row.
 *   instructor  none of that is accepted, so an Admin's fields sent here are
 *               dropped by the parse: the main instructor is forced to the
 *               caller, nobody supports, and the class is left Unpriced for an
 *               Admin to price from Payroll. Answers the narrower row.
 */
function classCreateFor<Body extends z.infer<z.ZodObject<typeof classType & typeof placeAndSeats & typeof rule>>>(spec: {
  body: BodyOf<Body>
  staffing: (b: Body, self: string) => Staffing
  json: (tenant: string, row: classesSvc.ClassRow) => Promise<unknown>
}) {
  return new Hono().post('/classes', zValidator('json', spec.body), async c => {
    const body = c.req.valid('json')
    const self = c.get('staffUserId')
    const row = await classesSvc.createClass(tenantId(c), {
      classTypeId: body.class_type_id,
      ...spec.staffing(body, self),
      locationId: body.location_id,
      roomId: body.room_id,
      startsAt: new Date(body.starts_at),
      endsAt: new Date(body.ends_at),
      capacityOnline: body.capacity_online,
      capacityWaitlist: body.capacity_waitlist,
      capacityBuffer: body.capacity_buffer,
      creditCost: body.credit_cost,
      ...(body.package_rule ? { packageRule: toPackageRule(body.package_rule) } : {}),
      createdByStaffId: self,
    })
    c.set('auditTarget', { table: 'classes', id: row.id })
    return c.json(await spec.json(tenantId(c), row), 201)
  })
}

const surfaces: Record<Surface, Hono> = {
  admin: classCreateFor({
    body: z
      .object({
        ...classType,
        main_instructor_id: z.string().uuid(),
        // New shape (per-instructor pay). `supporting_instructor_ids` (bare id array)
        // is kept for back-compat and means "these are the instructors, leave pay
        // alone" — send only one of the two; `supporting_instructors` wins.
        supporting_instructors: z.array(supportingInstructorSchema).optional(),
        supporting_instructor_ids: z.array(z.string().uuid()).optional(),
        ...placeAndSeats,
        // Optional: blank (omitted or null) leaves the class Unpriced, and an admin
        // prices it later from Finance's "Needs pay" filter. An explicit 0 is a
        // price. See be/docs/adr/0008-instructor-pay-is-optional-when-scheduling.md.
        instructor_pay_sgd: z.number().min(0).nullable().optional(),
        ...rule,
      })
      .refine(endsAfterStart, endsAfterStartIssue),
    staffing: b => ({
      mainInstructorId: b.main_instructor_id,
      ...(b.supporting_instructors !== undefined
        ? { supportingInstructors: toAssignments(b.supporting_instructors) }
        : {}),
      ...(b.supporting_instructor_ids !== undefined ? { supportingInstructorIds: b.supporting_instructor_ids } : {}),
      instructorPaySgd: b.instructor_pay_sgd ?? null,
    }),
    json: adminClassJson,
  }),
  instructor: classCreateFor({
    body: z.object({ ...classType, ...placeAndSeats, ...rule }).refine(endsAfterStart, endsAfterStartIssue),
    staffing: (_b, self) => ({
      mainInstructorId: self, // forced: instructors can only schedule themselves
      supportingInstructorIds: [], // instructors can't assign other instructors
      instructorPaySgd: null, // left unpriced; an admin sets pay from Payroll
    }),
    json: instructorClassJson,
  }),
}

export const classCreateRoutes = (surface: Surface): Hono => surfaces[surface]
