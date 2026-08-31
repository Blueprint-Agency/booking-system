import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/packages/corporate-packages'
import { tenantId } from '../../../middleware/tenant'

const statusEnum = z.enum(['active', 'archived'])

const priceField = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'must be numeric with up to 2 decimals')

const idParam = z.object({ id: z.string().uuid() })

const listQuery = z.object({
  status: statusEnum.optional(),
})

const createSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).nullish(),
  price_sgd: priceField,
})

const updateSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).nullish().optional(),
  price_sgd: priceField.optional(),
  status: statusEnum.optional(),
})

function serialize(r: svc.CorporatePackageRow) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    price_sgd: r.priceSgd,
    status: r.status,
    archived_at: r.archivedAt,
    created_at: r.createdAt,
    created_by_staff_id: r.createdByStaffId,
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const rows = await svc.listCorporatePackages(tenantId(c), q)
    return c.json({ corporatePackages: rows.map(serialize) })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.getCorporatePackage(tenantId(c), id)
    if (!row) return c.json({ error: 'not_found' }, 404)
    return c.json({ corporatePackage: serialize(row) })
  })
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const actor = c.get('staffUserId') as string
    const row = await svc.createCorporatePackage(tenantId(c), {
      name: body.name,
      description: body.description ?? null,
      priceSgd: body.price_sgd,
      createdByStaffId: actor,
    })
    c.set('auditTarget' as any, { table: 'corporate_packages', id: row.id })
    return c.json({ corporatePackage: serialize(row) }, 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')

    let row: svc.CorporatePackageRow | null = null

    // Apply non-status field updates only when at least one is present, to avoid
    // an empty Drizzle UPDATE.
    const hasFieldUpdate =
      body.name !== undefined || body.description !== undefined || body.price_sgd !== undefined
    if (hasFieldUpdate) {
      row = await svc.updateCorporatePackage(tenantId(c), id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description ?? null } : {}),
        ...(body.price_sgd !== undefined ? { priceSgd: body.price_sgd } : {}),
      })
      if (!row) return c.json({ error: 'not_found' }, 404)
    }

    if (body.status === 'archived') {
      row = await svc.archiveCorporatePackage(tenantId(c), id)
      if (!row) return c.json({ error: 'not_found' }, 404)
    } else if (body.status === 'active') {
      row = await svc.unarchiveCorporatePackage(tenantId(c), id)
      if (!row) return c.json({ error: 'not_found' }, 404)
    }

    if (!row) {
      // No fields and no status: just return the current row.
      row = await svc.getCorporatePackage(tenantId(c), id)
      if (!row) return c.json({ error: 'not_found' }, 404)
    }

    c.set('auditTarget' as any, { table: 'corporate_packages', id })
    return c.json({ corporatePackage: serialize(row) })
  })
  .post('/:id/unarchive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.unarchiveCorporatePackage(tenantId(c), id)
    if (!row) return c.json({ error: 'not_found' }, 404)
    c.set('auditTarget' as any, { table: 'corporate_packages', id })
    return c.json({ corporatePackage: serialize(row) })
  })
  .delete('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await svc.softDeleteCorporatePackage(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'corporate_packages', id })
    return c.body(null, 204)
  })

export default app
