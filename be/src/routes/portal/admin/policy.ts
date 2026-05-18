import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/policy/update'

const globalPatch = z.object({
  cancel_cap_count: z.number().int().min(0).optional(),
  cancel_cap_cycle_days: z.number().int().min(1).optional(),
  class_window_hours: z.number().int().min(0).optional(),
  pt_window_hours: z.number().int().min(0).optional(),
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
      },
      staffId,
    )
    c.set('auditTarget' as any, { table: 'global_policy', id: row.id })
    return c.json(serializeGlobal(row))
  })
  .patch('/pt', zValidator('json', ptPatch), async c => {
    const body = c.req.valid('json')
    const staffId = c.get('staffUserId')
    const row = await svc.updatePtBookingConfig({ bookInAdvanceDays: body.book_in_advance_days }, staffId)
    c.set('auditTarget' as any, { table: 'pt_booking_config', id: row.id })
    return c.json(serializePt(row))
  })

export default app
