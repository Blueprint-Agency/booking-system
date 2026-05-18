import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/packages/class-packages'

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

const idParam = z.object({ id: z.string().uuid() })

const createSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).nullish(),
  kind: kindEnum,
  credits: z.number().int().min(1).nullish(),
  validity_days: z.number().int().min(1).nullish(),
  duration_days: z.number().int().min(1).nullish(),
  price_sgd: priceField,
})

const updateSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).nullish().optional(),
  credits: z.number().int().min(1).nullish().optional(),
  validity_days: z.number().int().min(1).nullish().optional(),
  duration_days: z.number().int().min(1).nullish().optional(),
  price_sgd: priceField.optional(),
  status: statusEnum.optional(),
})

function serialize(r: svc.ClassPackageRow) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    kind: r.kind,
    credits: r.credits,
    validity_days: r.validityDays,
    duration_days: r.durationDays,
    price_sgd: r.priceSgd,
    status: r.status,
    archived_at: r.archivedAt,
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const rows = await svc.listClassPackages(q)
    return c.json({ class_packages: rows.map(serialize) })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    return c.json(serialize(await svc.getClassPackage(id)))
  })
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const row = await svc.createClassPackage({
      name: body.name,
      description: body.description ?? null,
      kind: body.kind,
      credits: body.credits ?? null,
      validityDays: body.validity_days ?? null,
      durationDays: body.duration_days ?? null,
      priceSgd: body.price_sgd,
    })
    c.set('auditTarget' as any, { table: 'class_packages', id: row.id })
    return c.json(serialize(row), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await svc.updateClassPackage(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.credits !== undefined ? { credits: body.credits ?? null } : {}),
      ...(body.validity_days !== undefined ? { validityDays: body.validity_days ?? null } : {}),
      ...(body.duration_days !== undefined ? { durationDays: body.duration_days ?? null } : {}),
      ...(body.price_sgd !== undefined ? { priceSgd: body.price_sgd } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    })
    c.set('auditTarget' as any, { table: 'class_packages', id })
    return c.json(serialize(row))
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.archiveClassPackage(id)
    c.set('auditTarget' as any, { table: 'class_packages', id })
    return c.json(serialize(row))
  })

export default app
