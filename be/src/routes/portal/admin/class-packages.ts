import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/packages/class-packages'
import {
  bestPrice,
  listManagedPromotionsFor,
  replacePromotionsForParent,
  serializePromotion,
  type PromotionWriteInput,
} from '../../../services/packages/promotions'

const kindEnum = z.enum(['credit_bundle', 'unlimited', 'trial'])
const statusEnum = z.enum(['active', 'archived'])

// SGD prices come in as either a string ("120.00") or a number (120).
// Normalise to a 2dp string for the numeric column.
const priceField = z.union([z.string(), z.number()]).transform(v => {
  const n = typeof v === 'string' ? Number(v) : v
  if (!Number.isFinite(n) || n < 0) throw new Error('price must be a non-negative number')
  return n.toFixed(2)
})

const listQuery = z.object({
  status: statusEnum.optional(),
  kind: kindEnum.optional(),
})

// Promotion wire shape — mirrors serializePromotion's snake_case output so write/read are symmetric.
const promotionInputSchema = z.object({
  id: z.string().uuid().nullish(),
  label: z.string().min(1).max(160),
  kind: z.enum(['percent', 'special_price']),
  percent_off: z.number().int().min(1).max(99).nullish(),
  special_price_sgd: priceField.nullish(),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
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

const idParam = z.object({ id: z.string().uuid() })

const createSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).nullish(),
  kind: kindEnum,
  credits: z.number().int().min(1).nullish(),
  validity_days: z.number().int().min(1).nullish(),
  duration_days: z.number().int().min(1).nullish(),
  price_sgd: priceField,
  promotions: z.array(promotionInputSchema).optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).nullish().optional(),
  credits: z.number().int().min(1).nullish().optional(),
  validity_days: z.number().int().min(1).nullish().optional(),
  duration_days: z.number().int().min(1).nullish().optional(),
  price_sgd: priceField.optional(),
  status: statusEnum.optional(),
  promotions: z.array(promotionInputSchema).optional(),
})

function serialize(
  r: svc.ClassPackageRow,
  promos: ReturnType<typeof serializePromotion>[] = [],
  effective: { effectivePriceSgd: string; appliedPromotionId: string | null } = {
    effectivePriceSgd: r.priceSgd,
    appliedPromotionId: null,
  },
) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    kind: r.kind,
    credits: r.credits,
    validity_days: r.validityDays,
    duration_days: r.durationDays,
    price_sgd: r.priceSgd,
    effective_price_sgd: effective.effectivePriceSgd,
    applied_promotion_id: effective.appliedPromotionId,
    promotions: promos,
    status: r.status,
    archived_at: r.archivedAt,
  }
}

async function serializeWithPromos(r: svc.ClassPackageRow) {
  const map = await listManagedPromotionsFor('class_package', [r.id])
  const promos = map[r.id] ?? []
  return serialize(
    r,
    promos.map(serializePromotion),
    bestPrice(r.priceSgd, promos),
  )
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const rows = await svc.listClassPackages(q)
    const ids = rows.map(r => r.id)
    const promosByPkg = await listManagedPromotionsFor('class_package', ids)
    return c.json({
      class_packages: rows.map(r => {
        const ps = promosByPkg[r.id] ?? []
        return serialize(r, ps.map(serializePromotion), bestPrice(r.priceSgd, ps))
      }),
    })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    return c.json(await serializeWithPromos(await svc.getClassPackage(id)))
  })
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const actor = c.get('staffUserId')
    const row = await svc.createClassPackage({
      name: body.name,
      description: body.description ?? null,
      kind: body.kind,
      credits: body.credits ?? null,
      validityDays: body.validity_days ?? null,
      durationDays: body.duration_days ?? null,
      priceSgd: body.price_sgd,
    })
    if (body.promotions && body.promotions.length) {
      await replacePromotionsForParent(
        'class_package',
        row.id,
        body.promotions.map(toPromotionWriteInput),
        actor,
      )
    }
    c.set('auditTarget' as any, { table: 'class_packages', id: row.id })
    return c.json(await serializeWithPromos(row), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const actor = c.get('staffUserId')
    const row = await svc.updateClassPackage(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.credits !== undefined ? { credits: body.credits ?? null } : {}),
      ...(body.validity_days !== undefined ? { validityDays: body.validity_days ?? null } : {}),
      ...(body.duration_days !== undefined ? { durationDays: body.duration_days ?? null } : {}),
      ...(body.price_sgd !== undefined ? { priceSgd: body.price_sgd } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    })
    if (body.promotions !== undefined) {
      await replacePromotionsForParent(
        'class_package',
        id,
        body.promotions.map(toPromotionWriteInput),
        actor,
      )
    }
    c.set('auditTarget' as any, { table: 'class_packages', id })
    return c.json(await serializeWithPromos(row))
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.archiveClassPackage(id)
    c.set('auditTarget' as any, { table: 'class_packages', id })
    return c.json(await serializeWithPromos(row))
  })
  .post('/:id/unarchive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.unarchiveClassPackage(id)
    c.set('auditTarget' as any, { table: 'class_packages', id })
    return c.json(await serializeWithPromos(row))
  })
  .delete('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await svc.softDeleteClassPackage(id)
    c.set('auditTarget' as any, { table: 'class_packages', id })
    return c.body(null, 204)
  })

export default app
