import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/packages/pt-packages'
import {
  bestPrice,
  listManagedPromotionsFor,
  replacePromotionsForParent,
  serializePromotion,
  type PromotionWriteInput,
} from '../../../services/packages/promotions'

const sessionTypeEnum = z.enum(['1on1', '2on1'])
const statusEnum = z.enum(['active', 'archived'])

const priceField = z.union([z.string(), z.number()]).transform(v => {
  const n = typeof v === 'string' ? Number(v) : v
  if (!Number.isFinite(n) || n < 0) throw new Error('price must be a non-negative number')
  return n.toFixed(2)
})

const idParam = z.object({ id: z.string().uuid() })

const listQuery = z.object({
  status: statusEnum.optional(),
  session_type: sessionTypeEnum.optional(),
})

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

const createSchema = z.object({
  name: z.string().min(1).max(160),
  session_type: sessionTypeEnum,
  num_sessions: z.number().int().min(1).max(200),
  price_sgd: priceField,
  promotions: z.array(promotionInputSchema).optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  num_sessions: z.number().int().min(1).max(200).optional(),
  price_sgd: priceField.optional(),
  status: statusEnum.optional(),
  promotions: z.array(promotionInputSchema).optional(),
})

function serialize(
  r: svc.PtPackageRow,
  promos: ReturnType<typeof serializePromotion>[] = [],
  effective: { effectivePriceSgd: string; appliedPromotionId: string | null } = {
    effectivePriceSgd: r.priceSgd,
    appliedPromotionId: null,
  },
) {
  return {
    id: r.id,
    name: r.name,
    session_type: r.sessionType,
    num_sessions: r.numSessions,
    price_sgd: r.priceSgd,
    effective_price_sgd: effective.effectivePriceSgd,
    applied_promotion_id: effective.appliedPromotionId,
    promotions: promos,
    status: r.status,
    archived_at: r.archivedAt,
  }
}

async function serializeWithPromos(r: svc.PtPackageRow) {
  const map = await listManagedPromotionsFor('pt_package', [r.id])
  const promos = map[r.id] ?? []
  return serialize(r, promos.map(serializePromotion), bestPrice(r.priceSgd, promos))
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const rows = await svc.listPtPackages({ status: q.status, sessionType: q.session_type })
    const promosByPkg = await listManagedPromotionsFor('pt_package', rows.map(r => r.id))
    return c.json({
      pt_packages: rows.map(r => {
        const ps = promosByPkg[r.id] ?? []
        return serialize(r, ps.map(serializePromotion), bestPrice(r.priceSgd, ps))
      }),
    })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    return c.json(await serializeWithPromos(await svc.getPtPackage(id)))
  })
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const actor = c.get('staffUserId')
    const row = await svc.createPtPackage({
      name: body.name,
      sessionType: body.session_type,
      numSessions: body.num_sessions,
      priceSgd: body.price_sgd,
    })
    if (body.promotions && body.promotions.length) {
      await replacePromotionsForParent(
        'pt_package',
        row.id,
        body.promotions.map(toPromotionWriteInput),
        actor,
      )
    }
    c.set('auditTarget' as any, { table: 'pt_packages', id: row.id })
    return c.json(await serializeWithPromos(row), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const actor = c.get('staffUserId')
    const row = await svc.updatePtPackage(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.num_sessions !== undefined ? { numSessions: body.num_sessions } : {}),
      ...(body.price_sgd !== undefined ? { priceSgd: body.price_sgd } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    })
    if (body.promotions !== undefined) {
      await replacePromotionsForParent(
        'pt_package',
        id,
        body.promotions.map(toPromotionWriteInput),
        actor,
      )
    }
    c.set('auditTarget' as any, { table: 'pt_packages', id })
    return c.json(await serializeWithPromos(row))
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.archivePtPackage(id)
    c.set('auditTarget' as any, { table: 'pt_packages', id })
    return c.json(await serializeWithPromos(row))
  })

export default app
