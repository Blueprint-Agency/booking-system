import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/policy/update'
import { explainInvalid } from '../../explain-invalid'
import { tenantId } from '../../../middleware/tenant'

// A Leave Cap is a headcount of instructors on study leave at once, not a number
// of days: at least 1 (zero would make study leave unobtainable) and at most 99,
// which is more instructors than the studio will ever have.
const LEAVE_CAP_MESSAGE = 'A Leave Cap must be between 1 and 99 instructors.'
/** A whole number in a range, refused with one sentence whichever bound it broke. */
const bounded = (message: string, min: number, max: number) =>
  z.number({ message }).int(message).min(min, message).max(max, message).optional()

const leaveCap = z.number().int(LEAVE_CAP_MESSAGE).min(1, LEAVE_CAP_MESSAGE).max(99, LEAVE_CAP_MESSAGE)

/** A year in hours: the longest a Cancellation Window may run. */
const MAX_WINDOW_HOURS = 365 * 24

const LEAVE_CONFLICT_MESSAGE = 'A leave conflict must be a pair of instructors.'

const explainPolicy = explainInvalid('That value is not allowed.', 'invalid_policy')

// Every field carries its own sentence, because `explainPolicy` hands
// the first issue's message straight to an admin — a field left with zod's
// default would answer them with "Number must be less than or equal to 365".
const globalPatch = z.object({
  // The Cancellation Cap switch. Off leaves the count and cycle stored,
  // unread, for when it is switched back on.
  cancel_cap_enabled: z
    .boolean({ message: 'The cancellation cap is either on or off.' })
    .optional(),
  // Each has a most, as every integer column does: past it the save overflowed
  // as a 500. A cycle or window of a year, or 999 cancellations in one,
  // already means "no limit" to every member.
  cancel_cap_count: bounded('A cancellation cap must be between 0 and 999.', 0, 999),
  cancel_cap_cycle_days: bounded('A cancellation cycle must be between 1 and 365 days.', 1, 365),
  class_window_hours: bounded('A class booking window must be between 0 and 8760 hours (a year).', 0, MAX_WINDOW_HOURS),
  pt_window_hours: bounded('A PT booking window must be between 0 and 8760 hours (a year).', 0, MAX_WINDOW_HOURS),
  leave_carry_over_cap_days: bounded('Carry-over must be between 0 and 365 days.', 0, 365),
  study_leave_cap: leaveCap.optional(),
  // The Cross-Location Add-On rate, per month. Repricing moves future purchases
  // only — every Add-On already sold is frozen at what its member paid (§5).
  cross_location_rate_sgd: z
    .number({ message: 'The Add-On rate must be a number.' })
    .min(0, 'The Add-On rate must be between $0 and $9999.')
    .max(9999, 'The Add-On rate must be between $0 and $9999.')
    .optional(),
  // Part Payment. Off unless the studio says otherwise; turning it off
  // hides the checkbox and leaves every Purchase already open resumable.
  part_payment_enabled: z
    .boolean({ message: 'Part Payment is either on or off.' })
    .optional(),
  // The Check-in Window. A day is the ceiling: a member checked in the
  // evening before a morning class has not arrived for anything.
  check_in_opens_minutes_before: bounded('Check-in can open between 0 and 1440 minutes early.', 0, 1440),
  // Every declared Leave Conflict, as one replacement set. Which pairs are
  // allowed — two different, active instructors, each pair once — is the
  // service's call; this only says what the shape has to be.
  leave_conflicts: z
    .array(
      z.object({
        instructor_a_id: z.string().uuid(LEAVE_CONFLICT_MESSAGE),
        instructor_b_id: z.string().uuid(LEAVE_CONFLICT_MESSAGE),
      }),
      { message: LEAVE_CONFLICT_MESSAGE },
    )
    .optional(),
})

// Either or both. At least a day for the minimum: a private session is never
// proposed for today. Min above max is the service's refusal, since it needs
// the stored value of whichever is left out.
const ptPatch = z
  .object({
    book_in_advance_days: z.number().int().min(1).max(365).optional(),
    min_book_in_advance_days: z.number().int().min(1).max(365).optional(),
  })
  .refine(v => v.book_in_advance_days !== undefined || v.min_book_in_advance_days !== undefined, {
    message: 'nothing to update',
  })

function serializeGlobal(r: svc.GlobalPolicyRow) {
  return {
    cancel_cap_enabled: r.cancelCapEnabled,
    cancel_cap_count: r.cancelCapCount,
    cancel_cap_cycle_days: r.cancelCapCycleDays,
    class_window_hours: r.classWindowHours,
    pt_window_hours: r.ptWindowHours,
    leave_carry_over_cap_days: r.leaveCarryOverCapDays,
    study_leave_cap: r.studyLeaveCap,
    cross_location_rate_sgd: r.crossLocationRateSgd,
    part_payment_enabled: r.partPaymentEnabled,
    check_in_opens_minutes_before: r.checkInOpensMinutesBefore,
    updated_at: r.updatedAt,
    updated_by_staff_id: r.updatedByStaffId,
  }
}

/** The declared pairs, lower id first, exactly as the table holds them. */
async function serializeConflicts(tenant: string) {
  return (await svc.readLeaveConflicts(tenant)).map(p => ({
    instructor_a_id: p.instructorAId,
    instructor_b_id: p.instructorBId,
  }))
}

function serializePt(r: svc.PtBookingConfigRow) {
  return {
    book_in_advance_days: r.bookInAdvanceDays,
    min_book_in_advance_days: r.minBookInAdvanceDays,
    updated_at: r.updatedAt,
    updated_by_staff_id: r.updatedByStaffId,
  }
}

const app = new Hono()
  .get('/', async c => {
    const { global_policy, pt_booking_config } = await svc.readPolicy(tenantId(c))
    return c.json({
      global_policy: serializeGlobal(global_policy),
      pt_booking_config: serializePt(pt_booking_config),
      leave_conflicts: await serializeConflicts(tenantId(c)),
    })
  })
  .patch('/global', zValidator('json', globalPatch, explainPolicy), async c => {
    const body = c.req.valid('json')
    const staffId = c.get('staffUserId')
    const row = await svc.updateGlobalPolicy(
      tenantId(c),
      {
        ...(body.cancel_cap_enabled !== undefined ? { cancelCapEnabled: body.cancel_cap_enabled } : {}),
        ...(body.cancel_cap_count !== undefined ? { cancelCapCount: body.cancel_cap_count } : {}),
        ...(body.cancel_cap_cycle_days !== undefined
          ? { cancelCapCycleDays: body.cancel_cap_cycle_days }
          : {}),
        ...(body.class_window_hours !== undefined ? { classWindowHours: body.class_window_hours } : {}),
        ...(body.pt_window_hours !== undefined ? { ptWindowHours: body.pt_window_hours } : {}),
        ...(body.leave_carry_over_cap_days !== undefined
          ? { leaveCarryOverCapDays: body.leave_carry_over_cap_days }
          : {}),
        ...(body.study_leave_cap !== undefined ? { studyLeaveCap: body.study_leave_cap } : {}),
        ...(body.cross_location_rate_sgd !== undefined
          ? { crossLocationRateSgd: body.cross_location_rate_sgd.toFixed(2) }
          : {}),
        ...(body.part_payment_enabled !== undefined
          ? { partPaymentEnabled: body.part_payment_enabled }
          : {}),
        ...(body.check_in_opens_minutes_before !== undefined
          ? { checkInOpensMinutesBefore: body.check_in_opens_minutes_before }
          : {}),
        ...(body.leave_conflicts !== undefined
          ? {
              leaveConflictPairs: body.leave_conflicts.map(p => ({
                instructorAId: p.instructor_a_id,
                instructorBId: p.instructor_b_id,
              })),
            }
          : {}),
      },
      staffId,
    )
    c.set('auditTarget', { table: 'global_policy', id: row.id })
    return c.json({
      ...serializeGlobal(row),
      leave_conflicts: await serializeConflicts(tenantId(c)),
    })
  })
  .patch('/pt', zValidator('json', ptPatch), async c => {
    const body = c.req.valid('json')
    const staffId = c.get('staffUserId')
    const row = await svc.updatePtBookingConfig(
      tenantId(c),
      {
        ...(body.book_in_advance_days !== undefined ? { bookInAdvanceDays: body.book_in_advance_days } : {}),
        ...(body.min_book_in_advance_days !== undefined
          ? { minBookInAdvanceDays: body.min_book_in_advance_days }
          : {}),
      },
      staffId,
    )
    c.set('auditTarget', { table: 'pt_booking_config', id: row.id })
    return c.json(serializePt(row))
  })

export default app
