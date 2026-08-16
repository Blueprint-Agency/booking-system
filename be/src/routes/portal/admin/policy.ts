import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/policy/update'

const globalPatch = z.object({
  cancel_cap_count: z.number().int().min(0).optional(),
  cancel_cap_cycle_days: z.number().int().min(1).optional(),
  class_window_hours: z.number().int().min(0).optional(),
  pt_window_hours: z.number().int().min(0).optional(),
  leave_carry_over_cap_days: z.number().int().min(0).max(365).optional(),
  // Both Leave Caps are at least 1: zero would freeze annual leave studio-wide.
  cover_group_leave_cap: z.number().int().min(1).max(365).optional(),
  study_leave_cap: z.number().int().min(1).max(365).optional(),
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
  .patch('/global', zValidator('json', globalPatch), async c => {
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
      },
      staffId,
    )
    if (body.cover_group_staff_ids !== undefined) await svc.setCoverGroup(body.cover_group_staff_ids)
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
