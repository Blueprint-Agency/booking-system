import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as publish from '../../../services/workshops/publish'
import * as daysSvc from '../../../services/workshops/days'
import * as tiersSvc from '../../../services/workshops/tiers'
import * as cancelSvc from '../../../services/workshops/cancel'
import {
  listManagedPromotionsFor,
  replacePromotionsForParent,
  serializePromotion,
  type PromotionWriteInput,
} from '../../../services/packages/promotions'

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const idParam = z.object({ id: z.string().uuid() })
const idDayParam = z.object({ id: z.string().uuid(), day_id: z.string().uuid() })
const idTierParam = z.object({ id: z.string().uuid(), tier_id: z.string().uuid() })

const lifecycleEnum = z.enum(['active', 'cancelled'])

const priceField = z.union([z.string(), z.number()]).transform(v => {
  const n = typeof v === 'string' ? Number(v) : v
  if (!Number.isFinite(n) || n < 0) throw new Error('price must be a non-negative number')
  return n.toFixed(2)
})

const isoDate = z.string().datetime({ offset: true })

const createBasicsSchema = z.object({
  name: z.string().min(1).max(200),
  location_id: z.string().uuid(),
  description_html: z.string().max(20000).nullish(),
  cover_r2_key: z.string().max(500).nullish(),
  main_instructor_id: z.string().uuid(),
  supporting_instructor_ids: z.array(z.string().uuid()).default([]),
  image_r2_keys: z.array(z.string().max(500)).default([]),
})

const workshopInstructorSchema = z.object({
  instructor_id: z.string().uuid(),
  pay_sgd: z.number().min(0).nullable().optional(),
})

const updateBasicsSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  location_id: z.string().uuid().optional(),
  description_html: z.string().max(20000).nullish().optional(),
  cover_r2_key: z.string().max(500).nullish().optional(),
  main_instructor_id: z.string().uuid().optional(),
  main_instructor_pay_sgd: z.number().min(0).nullable().optional(),
  // New shape (per-instructor pay). `supporting_instructor_ids` (bare id array,
  // pay defaults to null) is kept for back-compat until the frontend edit UI
  // task lands — only one of the two may be sent.
  supporting_instructors: z.array(workshopInstructorSchema).optional(),
  supporting_instructor_ids: z.array(z.string().uuid()).optional(),
  image_r2_keys: z.array(z.string().max(500)).optional(),
})

const dayCreateSchema = z.object({
  ord: z.number().int().min(1),
  room_id: z.string().uuid(),
  starts_at: isoDate,
  ends_at: isoDate,
  // Per-day base_price_sgd is retained at the DB level but is no longer
  // surfaced in the admin UI — pricing lives on workshop_tiers. Default to 0
  // so the column's NOT NULL constraint stays satisfied.
  base_price_sgd: priceField.optional(),
  capacity_online: z.number().int().min(0),
  capacity_waitlist: z.number().int().min(0).optional(),
  capacity_buffer: z.number().int().min(0).optional(),
})
const dayUpdateSchema = dayCreateSchema.partial()

const tierCreateSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).nullish(),
  regular_price_sgd: priceField,
  early_bird_price_sgd: priceField.nullish(),
  early_bird_quota: z.number().int().min(1).nullish(),
  early_bird_cutoff_at: isoDate.nullish(),
  ord: z.number().int().min(1),
  day_ids: z.array(z.string().uuid()).min(1),
})

const tierUpdateSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).nullish().optional(),
  regular_price_sgd: priceField.optional(),
  early_bird_price_sgd: priceField.nullish().optional(),
  early_bird_quota: z.number().int().min(1).nullish().optional(),
  early_bird_cutoff_at: isoDate.nullish().optional(),
  ord: z.number().int().min(1).optional(),
  day_ids: z.array(z.string().uuid()).min(1).optional(),
})

const listQuery = z.object({ lifecycle: lifecycleEnum.optional() })

const promotionInputSchema = z.object({
  id: z.string().uuid().nullish(),
  label: z.string().min(1).max(160),
  kind: z.enum(['percent', 'special_price']),
  percent_off: z.number().int().min(1).max(99).nullish(),
  special_price_sgd: priceField.nullish(),
  starts_at: isoDate,
  ends_at: isoDate,
})

const replacePromotionsSchema = z.object({
  promotions: z.array(promotionInputSchema),
})

function toPromotionWriteInput(p: z.infer<typeof promotionInputSchema>): PromotionWriteInput {
  return {
    id: p.id ?? null,
    label: p.label,
    kind: p.kind,
    percentOff: p.percent_off ?? null,
    specialPriceSgd: p.special_price_sgd ?? null,
    startsAt: new Date(p.starts_at),
    endsAt: new Date(p.ends_at),
  }
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function workshopRow(w: publish.WorkshopRow) {
  return {
    id: w.id,
    name: w.name,
    location_id: w.locationId,
    cover_r2_key: w.coverR2Key,
    description_html: w.descriptionHtml,
    lifecycle: w.lifecycle,
    cancelled_at: w.cancelledAt,
    cancelled_by_staff_id: w.cancelledByStaffId,
    created_at: w.createdAt,
    created_by_staff_id: w.createdByStaffId,
  }
}

function dayRow(d: daysSvc.WorkshopDayRow) {
  return {
    id: d.id,
    workshop_id: d.workshopId,
    ord: d.ord,
    room_id: d.roomId,
    starts_at: d.startsAt,
    ends_at: d.endsAt,
    base_price_sgd: d.basePriceSgd,
    capacity_online: d.capacityOnline,
    capacity_waitlist: d.capacityWaitlist,
    capacity_buffer: d.capacityBuffer,
  }
}

function tierRow(t: tiersSvc.TierWithDays) {
  return {
    id: t.id,
    workshop_id: t.workshopId,
    name: t.name,
    description: t.description,
    regular_price_sgd: t.regularPriceSgd,
    early_bird_price_sgd: t.earlyBirdPriceSgd,
    early_bird_quota: t.earlyBirdQuota,
    early_bird_cutoff_at: t.earlyBirdCutoffAt,
    ord: t.ord,
    day_ids: t.dayIds,
  }
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

const app = new Hono()
  // ---- workshop basics ----
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const rows = await publish.listWorkshops({ lifecycle: q.lifecycle })
    const instructorMap = await publish.listInstructorsByWorkshop(rows.map(r => r.id))
    return c.json({
      workshops: rows.map(r => {
        const m = instructorMap.get(r.id) ?? { mainInstructorId: null, supportingInstructorIds: [] }
        const instructor_ids = m.mainInstructorId
          ? [m.mainInstructorId, ...m.supportingInstructorIds]
          : [...m.supportingInstructorIds]
        return {
          ...workshopRow(r),
          main_instructor_id: m.mainInstructorId,
          supporting_instructor_ids: m.supportingInstructorIds,
          instructor_ids,
        }
      }),
    })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const detail = await publish.getWorkshopDetail(id)
    const promosMap = await listManagedPromotionsFor('workshop', [id])
    return c.json({
      ...workshopRow(detail.workshop),
      days: detail.days.map(dayRow),
      tiers: detail.tiers.map(t => tierRow(t as tiersSvc.TierWithDays)),
      images: detail.images.map(im => ({ id: im.id, r2_key: im.r2Key, ord: im.ord })),
      main_instructor_id: detail.mainInstructorId,
      main_instructor_pay_sgd: detail.mainInstructorPaySgd,
      supporting_instructor_ids: detail.supportingInstructorIds,
      supporting_instructors: detail.supportingInstructors.map(s => ({
        instructor_id: s.instructorId,
        pay_sgd: s.paySgd,
      })),
      instructor_ids: detail.instructorIds,
      promotions: (promosMap[id] ?? []).map(serializePromotion),
    })
  })
  .post('/', zValidator('json', createBasicsSchema), async c => {
    const body = c.req.valid('json')
    const staffId = c.get('staffUserId')
    const row = await publish.createWorkshop({
      name: body.name,
      locationId: body.location_id,
      descriptionHtml: body.description_html ?? null,
      coverR2Key: body.cover_r2_key ?? null,
      mainInstructorId: body.main_instructor_id,
      supportingInstructorIds: body.supporting_instructor_ids,
      imageR2Keys: body.image_r2_keys,
      createdByStaffId: staffId,
    })
    c.set('auditTarget' as any, { table: 'workshops', id: row.id })
    return c.json(workshopRow(row), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateBasicsSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    // Back-compat: bare `supporting_instructor_ids` (old shape, pay defaults
    // to null) still works alongside the new `supporting_instructors` shape.
    let supportingInstructors: publish.WorkshopInstructorInput[] | undefined
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
    const row = await publish.updateWorkshop(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.location_id !== undefined ? { locationId: body.location_id } : {}),
      ...(body.description_html !== undefined ? { descriptionHtml: body.description_html ?? null } : {}),
      ...(body.cover_r2_key !== undefined ? { coverR2Key: body.cover_r2_key ?? null } : {}),
      ...(body.main_instructor_id !== undefined
        ? { mainInstructorId: body.main_instructor_id }
        : {}),
      ...(body.main_instructor_pay_sgd !== undefined
        ? { mainInstructorPaySgd: body.main_instructor_pay_sgd }
        : {}),
      ...(supportingInstructors !== undefined ? { supportingInstructors } : {}),
      ...(body.image_r2_keys !== undefined ? { imageR2Keys: body.image_r2_keys } : {}),
    })
    c.set('auditTarget' as any, { table: 'workshops', id })
    return c.json(workshopRow(row))
  })
  .post('/:id/cancel', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const staffId = c.get('staffUserId')
    const row = await cancelSvc.cancelWorkshop(id, staffId)
    c.set('auditTarget' as any, { table: 'workshops', id })
    return c.json(workshopRow(row))
  })

  // ---- workshop_days ----
  .get('/:id/days', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const rows = await daysSvc.listDays(id)
    return c.json({ days: rows.map(dayRow) })
  })
  .post('/:id/days', zValidator('param', idParam), zValidator('json', dayCreateSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await daysSvc.createDay(id, {
      ord: body.ord,
      roomId: body.room_id,
      startsAt: new Date(body.starts_at),
      endsAt: new Date(body.ends_at),
      basePriceSgd: body.base_price_sgd ?? '0.00',
      capacityOnline: body.capacity_online,
      capacityWaitlist: body.capacity_waitlist,
      capacityBuffer: body.capacity_buffer,
    })
    c.set('auditTarget' as any, { table: 'workshop_days', id: row.id })
    return c.json(dayRow(row), 201)
  })
  .patch(
    '/:id/days/:day_id',
    zValidator('param', idDayParam),
    zValidator('json', dayUpdateSchema),
    async c => {
      const { id, day_id } = c.req.valid('param')
      const body = c.req.valid('json')
      const row = await daysSvc.updateDay(id, day_id, {
        ...(body.ord !== undefined ? { ord: body.ord } : {}),
        ...(body.room_id !== undefined ? { roomId: body.room_id } : {}),
        ...(body.starts_at !== undefined ? { startsAt: new Date(body.starts_at) } : {}),
        ...(body.ends_at !== undefined ? { endsAt: new Date(body.ends_at) } : {}),
        ...(body.base_price_sgd !== undefined ? { basePriceSgd: body.base_price_sgd } : {}),
        ...(body.capacity_online !== undefined ? { capacityOnline: body.capacity_online } : {}),
        ...(body.capacity_waitlist !== undefined ? { capacityWaitlist: body.capacity_waitlist } : {}),
        ...(body.capacity_buffer !== undefined ? { capacityBuffer: body.capacity_buffer } : {}),
      })
      c.set('auditTarget' as any, { table: 'workshop_days', id: day_id })
      return c.json(dayRow(row))
    },
  )
  .delete('/:id/days/:day_id', zValidator('param', idDayParam), async c => {
    const { id, day_id } = c.req.valid('param')
    await daysSvc.deleteDay(id, day_id)
    c.set('auditTarget' as any, { table: 'workshop_days', id: day_id })
    return c.json({ deleted: true })
  })

  // ---- workshop_tiers ----
  .get('/:id/tiers', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const rows = await tiersSvc.listTiers(id)
    return c.json({ tiers: rows.map(tierRow) })
  })
  .post('/:id/tiers', zValidator('param', idParam), zValidator('json', tierCreateSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await tiersSvc.createTier(id, {
      name: body.name,
      description: body.description ?? null,
      regularPriceSgd: body.regular_price_sgd,
      earlyBirdPriceSgd: body.early_bird_price_sgd ?? null,
      earlyBirdQuota: body.early_bird_quota ?? null,
      earlyBirdCutoffAt: body.early_bird_cutoff_at ? new Date(body.early_bird_cutoff_at) : null,
      ord: body.ord,
      dayIds: body.day_ids,
    })
    c.set('auditTarget' as any, { table: 'workshop_tiers', id: row.id })
    return c.json(tierRow(row), 201)
  })
  .patch(
    '/:id/tiers/:tier_id',
    zValidator('param', idTierParam),
    zValidator('json', tierUpdateSchema),
    async c => {
      const { id, tier_id } = c.req.valid('param')
      const body = c.req.valid('json')
      const row = await tiersSvc.updateTier(id, tier_id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description ?? null } : {}),
        ...(body.regular_price_sgd !== undefined ? { regularPriceSgd: body.regular_price_sgd } : {}),
        ...(body.early_bird_price_sgd !== undefined
          ? { earlyBirdPriceSgd: body.early_bird_price_sgd ?? null }
          : {}),
        ...(body.early_bird_quota !== undefined ? { earlyBirdQuota: body.early_bird_quota ?? null } : {}),
        ...(body.early_bird_cutoff_at !== undefined
          ? {
              earlyBirdCutoffAt: body.early_bird_cutoff_at
                ? new Date(body.early_bird_cutoff_at)
                : null,
            }
          : {}),
        ...(body.ord !== undefined ? { ord: body.ord } : {}),
        ...(body.day_ids !== undefined ? { dayIds: body.day_ids } : {}),
      })
      c.set('auditTarget' as any, { table: 'workshop_tiers', id: tier_id })
      return c.json(tierRow(row))
    },
  )
  .delete('/:id/tiers/:tier_id', zValidator('param', idTierParam), async c => {
    const { id, tier_id } = c.req.valid('param')
    await tiersSvc.deleteTier(id, tier_id)
    c.set('auditTarget' as any, { table: 'workshop_tiers', id: tier_id })
    return c.json({ deleted: true })
  })

  // ---- workshop promotions (applied to all tiers of the workshop) ----
  .get('/:id/promotions', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const map = await listManagedPromotionsFor('workshop', [id])
    return c.json({ promotions: (map[id] ?? []).map(serializePromotion) })
  })
  .put(
    '/:id/promotions',
    zValidator('param', idParam),
    zValidator('json', replacePromotionsSchema),
    async c => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const staffId = c.get('staffUserId')
      const rows = await replacePromotionsForParent(
        'workshop',
        id,
        body.promotions.map(toPromotionWriteInput),
        staffId,
      )
      c.set('auditTarget' as any, { table: 'promotions', id })
      return c.json({ promotions: rows.map(serializePromotion) })
    },
  )

  // ---- roster (v0 stubs — no bookings yet) ----
  .get('/:id/roster', zValidator('param', idParam), async c => {
    return c.json({ roster: [], note: 'roster: v0 stub — no bookings yet' })
  })
  .get('/:id/days/:day_id/roster', zValidator('param', idDayParam), async c => {
    return c.json({ roster: [], note: 'roster: v0 stub — no bookings yet' })
  })

export default app
