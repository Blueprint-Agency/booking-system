import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/packages/class-packages'
import {
  bestPrice,
  listManagedPromotionsFor,
  replacePromotionsForParent,
  serializePromotion,
} from '../../../services/packages/promotions'
import { MAX_DURATION_MONTHS } from '../../../services/packages/validity'
import { tenantId } from '../../../middleware/tenant'
import { explainInvalid } from '../../explain-invalid'
import { nameField, priceField, promotionsField, toPromotionWriteInput, validityDaysField } from './package-fields'

const kindEnum = z.enum(['credit_bundle', 'unlimited', 'trial'], {
  message: 'A class package is a credit bundle, an unlimited plan or a trial.',
})
const statusEnum = z.enum(['active', 'archived'], { message: 'A status is active or archived.' })

const listQuery = z.object({
  status: statusEnum.optional(),
  kind: kindEnum.optional(),
})

const idParam = z.object({ id: z.string().uuid() })

const DURATION_MESSAGE = `A plan runs a whole number of months from 1 to ${MAX_DURATION_MONTHS}.`
const durationMonthsField = z.number({ message: DURATION_MESSAGE }).int(DURATION_MESSAGE).min(1, DURATION_MESSAGE).max(MAX_DURATION_MONTHS, DURATION_MESSAGE)
const CREDITS_MESSAGE = 'Credits must be a whole number of at least 1.'
const creditsField = z.number({ message: CREDITS_MESSAGE }).int(CREDITS_MESSAGE).min(1, CREDITS_MESSAGE)
const descriptionField = z.string({ message: 'A description must be text.' }).max(2000, 'A description can be at most 2000 characters.')
const explainPackage = explainInvalid('That class package is not valid.')

const createSchema = z.object({
  name: nameField,
  description: descriptionField.nullish(),
  kind: kindEnum,
  credits: creditsField.nullish(),
  validity_days: validityDaysField.nullish(),
  duration_months: durationMonthsField.nullish(),
  price_sgd: priceField,
  promotions: promotionsField.optional(),
})

const updateSchema = z.object({
  name: nameField.optional(),
  description: descriptionField.nullish().optional(),
  credits: creditsField.nullish().optional(),
  validity_days: validityDaysField.nullish().optional(),
  duration_months: durationMonthsField.nullish().optional(),
  price_sgd: priceField.optional(),
  status: statusEnum.optional(),
  promotions: promotionsField.optional(),
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
    duration_months: r.durationMonths,
    price_sgd: r.priceSgd,
    effective_price_sgd: effective.effectivePriceSgd,
    applied_promotion_id: effective.appliedPromotionId,
    promotions: promos,
    status: r.status,
    archived_at: r.archivedAt,
  }
}

async function serializeWithPromos(tenant: string, r: svc.ClassPackageRow) {
  const map = await listManagedPromotionsFor(tenant, 'class_package', [r.id])
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
    const rows = await svc.listClassPackages(tenantId(c), q)
    const ids = rows.map(r => r.id)
    const promosByPkg = await listManagedPromotionsFor(tenantId(c), 'class_package', ids)
    return c.json({
      class_packages: rows.map(r => {
        const ps = promosByPkg[r.id] ?? []
        return serialize(r, ps.map(serializePromotion), bestPrice(r.priceSgd, ps))
      }),
    })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    return c.json(await serializeWithPromos(tenantId(c), await svc.getClassPackage(tenantId(c), id)))
  })
  .post('/', zValidator('json', createSchema, explainPackage), async c => {
    const body = c.req.valid('json')
    const actor = c.get('staffUserId')
    const row = await svc.createClassPackage(tenantId(c), {
      name: body.name,
      description: body.description ?? null,
      kind: body.kind,
      credits: body.credits ?? null,
      validityDays: body.validity_days ?? null,
      durationMonths: body.duration_months ?? null,
      priceSgd: body.price_sgd,
    })
    if (body.promotions && body.promotions.length) {
      await replacePromotionsForParent(
        tenantId(c),
        'class_package',
        row.id,
        body.promotions.map(toPromotionWriteInput),
        actor,
      )
    }
    c.set('auditTarget' as any, { table: 'class_packages', id: row.id })
    return c.json(await serializeWithPromos(tenantId(c), row), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema, explainPackage), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const actor = c.get('staffUserId')
    const row = await svc.updateClassPackage(tenantId(c), id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.credits !== undefined ? { credits: body.credits ?? null } : {}),
      ...(body.validity_days !== undefined ? { validityDays: body.validity_days ?? null } : {}),
      ...(body.duration_months !== undefined ? { durationMonths: body.duration_months ?? null } : {}),
      ...(body.price_sgd !== undefined ? { priceSgd: body.price_sgd } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    })
    if (body.promotions !== undefined) {
      await replacePromotionsForParent(
        tenantId(c),
        'class_package',
        id,
        body.promotions.map(toPromotionWriteInput),
        actor,
      )
    }
    c.set('auditTarget' as any, { table: 'class_packages', id })
    return c.json(await serializeWithPromos(tenantId(c), row))
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.archiveClassPackage(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'class_packages', id })
    return c.json(await serializeWithPromos(tenantId(c), row))
  })
  .post('/:id/unarchive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.unarchiveClassPackage(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'class_packages', id })
    return c.json(await serializeWithPromos(tenantId(c), row))
  })
  .delete('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await svc.softDeleteClassPackage(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'class_packages', id })
    return c.body(null, 204)
  })

export default app
