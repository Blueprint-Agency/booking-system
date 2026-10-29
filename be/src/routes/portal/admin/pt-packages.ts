import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/packages/pt-packages'
import {
  bestPrice,
  listManagedPromotionsFor,
  replacePromotionsForParent,
  serializePromotion,
} from '../../../services/packages/promotions'
import { tenantId } from '../../../middleware/tenant'
import { explainInvalid } from '../../explain-invalid'
import { nameField, priceField, promotionsField, toPromotionWriteInput, validityDaysField } from './package-fields'

const sessionTypeEnum = z.enum(['1on1', '2on1'], { message: 'A PT package is 1-on-1 or 2-on-1.' })
const statusEnum = z.enum(['active', 'archived'], { message: 'A status is active or archived.' })

const idParam = z.object({ id: z.string().uuid() })

const listQuery = z.object({
  status: statusEnum.optional(),
  session_type: sessionTypeEnum.optional(),
})

const SESSIONS_MESSAGE = 'Sessions must be a whole number from 1 to 200.'
const numSessionsField = z.number({ message: SESSIONS_MESSAGE }).int(SESSIONS_MESSAGE).min(1, SESSIONS_MESSAGE).max(200, SESSIONS_MESSAGE)
const instructorBoundField = z.boolean({ message: 'Bound to an instructor is either on or off.' })
const explainPackage = explainInvalid('That PT package is not valid.')

// Validity is required on create and never nullable: "never expires" has left
// the domain, so a blank field cannot be how an admin creates an eternal PT package.
const createSchema = z.object({
  name: nameField,
  session_type: sessionTypeEnum,
  num_sessions: numSessionsField,
  validity_days: validityDaysField,
  // Absent means off — a studio that has never heard of binding keeps
  // selling open packages without sending the field.
  instructor_bound: instructorBoundField.optional(),
  price_sgd: priceField,
  promotions: promotionsField.optional(),
})

const updateSchema = z.object({
  name: nameField.optional(),
  num_sessions: numSessionsField.optional(),
  validity_days: validityDaysField.optional(),
  instructor_bound: instructorBoundField.optional(),
  price_sgd: priceField.optional(),
  status: statusEnum.optional(),
  promotions: promotionsField.optional(),
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
    validity_days: r.validityDays,
    instructor_bound: r.instructorBound,
    price_sgd: r.priceSgd,
    effective_price_sgd: effective.effectivePriceSgd,
    applied_promotion_id: effective.appliedPromotionId,
    promotions: promos,
    status: r.status,
    archived_at: r.archivedAt,
  }
}

async function serializeWithPromos(tenant: string, r: svc.PtPackageRow) {
  const map = await listManagedPromotionsFor(tenant, 'pt_package', [r.id])
  const promos = map[r.id] ?? []
  return serialize(r, promos.map(serializePromotion), bestPrice(r.priceSgd, promos))
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const rows = await svc.listPtPackages(tenantId(c), {
      status: q.status,
      sessionType: q.session_type,
    })
    const promosByPkg = await listManagedPromotionsFor(
      tenantId(c),
      'pt_package',
      rows.map(r => r.id),
    )
    return c.json({
      pt_packages: rows.map(r => {
        const ps = promosByPkg[r.id] ?? []
        return serialize(r, ps.map(serializePromotion), bestPrice(r.priceSgd, ps))
      }),
    })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    return c.json(await serializeWithPromos(tenantId(c), await svc.getPtPackage(tenantId(c), id)))
  })
  .post('/', zValidator('json', createSchema, explainPackage), async c => {
    const body = c.req.valid('json')
    const actor = c.get('staffUserId')
    const row = await svc.createPtPackageWithPromotions(
      tenantId(c),
      {
        name: body.name,
        sessionType: body.session_type,
        numSessions: body.num_sessions,
        validityDays: body.validity_days,
        instructorBound: body.instructor_bound,
        priceSgd: body.price_sgd,
      },
      (body.promotions ?? []).map(toPromotionWriteInput),
      actor,
    )
    c.set('auditTarget', { table: 'pt_packages', id: row.id })
    return c.json(await serializeWithPromos(tenantId(c), row), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema, explainPackage), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const actor = c.get('staffUserId')
    const row = await svc.updatePtPackage(tenantId(c), id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.num_sessions !== undefined ? { numSessions: body.num_sessions } : {}),
      ...(body.validity_days !== undefined ? { validityDays: body.validity_days } : {}),
      ...(body.instructor_bound !== undefined
        ? { instructorBound: body.instructor_bound }
        : {}),
      ...(body.price_sgd !== undefined ? { priceSgd: body.price_sgd } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    })
    if (body.promotions !== undefined) {
      await replacePromotionsForParent(
        tenantId(c),
        'pt_package',
        id,
        body.promotions.map(toPromotionWriteInput),
        actor,
      )
    }
    c.set('auditTarget', { table: 'pt_packages', id })
    return c.json(await serializeWithPromos(tenantId(c), row))
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.archivePtPackage(tenantId(c), id)
    c.set('auditTarget', { table: 'pt_packages', id })
    return c.json(await serializeWithPromos(tenantId(c), row))
  })
  .post('/:id/unarchive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.unarchivePtPackage(tenantId(c), id)
    c.set('auditTarget', { table: 'pt_packages', id })
    return c.json(await serializeWithPromos(tenantId(c), row))
  })
  .delete('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await svc.softDeletePtPackage(tenantId(c), id)
    c.set('auditTarget', { table: 'pt_packages', id })
    return c.body(null, 204)
  })

export default app
