import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/policy/update'
import { BadRequestError } from '../../../shared/errors'

// A Leave Cap is a headcount of instructors away at once, not a number of days:
// at least 1 (zero would freeze annual leave studio-wide) and at most 99, which
// is more instructors than the studio will ever have.
const LEAVE_CAP_MESSAGE = 'A Leave Cap must be between 1 and 99 instructors.'
const leaveCap = z.number().int().min(1, LEAVE_CAP_MESSAGE).max(99, LEAVE_CAP_MESSAGE)

/** A rejected body answers with a reason an admin can read, not a raw zod dump. */
const explainInvalid = (result: { success: boolean; error?: unknown }) => {
  if (result.success) return
  const issues = (result.error as z.ZodError | undefined)?.issues
  throw new BadRequestError('invalid_policy', {
    message: issues?.[0]?.message ?? 'That value is not allowed.',
  })
}

const globalPatch = z.object({
  cancel_cap_count: z.number().int().min(0).optional(),
  cancel_cap_cycle_days: z.number().int().min(1).optional(),
  class_window_hours: z.number().int().min(0).optional(),
  pt_window_hours: z.number().int().min(0).optional(),
  leave_carry_over_cap_days: z.number().int().min(0).max(365).optional(),
  cover_group_leave_cap: leaveCap.optional(),
  study_leave_cap: leaveCap.optional(),
  // The Cross-Location Add-On rate, per month. Repricing moves future purchases
  // only — every Add-On already sold is frozen at what its member paid (§5).
  cross_location_rate_sgd: z.number().min(0).max(9999).optional(),
  // The whole Cover Group, as one ticked set of instructor staff user ids.
  cover_group_staff_ids: z.array(z.string().uuid()).optional(),
})

const ptPatch = z.object({
  book_in_advance_days: z.number().int().min(1).max(365),
})

function serializeGlobal(r: svc.GlobalPolicyRow) {
  return {
    cancel_cap_count: r.cancelCapCount,
    cancel_cap_cycle_days: r.cancelCapCycleDays,
    class_window_hours: r.classWindowHours,
    pt_window_hours: r.ptWindowHours,
    leave_carry_over_cap_days: r.leaveCarryOverCapDays,
    cover_group_leave_cap: r.coverGroupLeaveCap,
    study_leave_cap: r.studyLeaveCap,
    cross_location_rate_sgd: r.crossLocationRateSgd,
    updated_at: r.updatedAt,
    updated_by_staff_id: r.updatedByStaffId,
  }
}

function serializePt(r: svc.PtBookingConfigRow) {
  return {
    book_in_advance_days: r.bookInAdvanceDays,
    updated_at: r.updatedAt,
    updated_by_staff_id: r.updatedByStaffId,
  }
}

const app = new Hono()
  .get('/', async c => {
    const { global_policy, pt_booking_config } = await svc.readPolicy()
    return c.json({
      global_policy: serializeGlobal(global_policy),
      pt_booking_config: serializePt(pt_booking_config),
      cover_group_staff_ids: await svc.readCoverGroup(),
    })
  })
  .patch('/global', zValidator('json', globalPatch, explainInvalid), async c => {
    const body = c.req.valid('json')
    const staffId = c.get('staffUserId')
    const row = await svc.updateGlobalPolicy(
      {
        ...(body.cancel_cap_count !== undefined ? { cancelCapCount: body.cancel_cap_count } : {}),
        ...(body.cancel_cap_cycle_days !== undefined
          ? { cancelCapCycleDays: body.cancel_cap_cycle_days }
          : {}),
        ...(body.class_window_hours !== undefined ? { classWindowHours: body.class_window_hours } : {}),
        ...(body.pt_window_hours !== undefined ? { ptWindowHours: body.pt_window_hours } : {}),
        ...(body.leave_carry_over_cap_days !== undefined
          ? { leaveCarryOverCapDays: body.leave_carry_over_cap_days }
          : {}),
        ...(body.cover_group_leave_cap !== undefined
          ? { coverGroupLeaveCap: body.cover_group_leave_cap }
          : {}),
        ...(body.study_leave_cap !== undefined ? { studyLeaveCap: body.study_leave_cap } : {}),
        ...(body.cross_location_rate_sgd !== undefined
          ? { crossLocationRateSgd: body.cross_location_rate_sgd.toFixed(2) }
          : {}),
        ...(body.cover_group_staff_ids !== undefined
          ? { coverGroupStaffIds: body.cover_group_staff_ids }
          : {}),
      },
      staffId,
    )
    c.set('auditTarget' as any, { table: 'global_policy', id: row.id })
    return c.json({ ...serializeGlobal(row), cover_group_staff_ids: await svc.readCoverGroup() })
  })
  .patch('/pt', zValidator('json', ptPatch), async c => {
    const body = c.req.valid('json')
    const staffId = c.get('staffUserId')
    const row = await svc.updatePtBookingConfig({ bookInAdvanceDays: body.book_in_advance_days }, staffId)
    c.set('auditTarget' as any, { table: 'pt_booking_config', id: row.id })
    return c.json(serializePt(row))
  })

export default app
