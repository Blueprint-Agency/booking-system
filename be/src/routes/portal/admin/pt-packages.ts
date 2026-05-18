import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/packages/pt-packages'

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

const createSchema = z.object({
  name: z.string().min(1).max(160),
  session_type: sessionTypeEnum,
  num_sessions: z.number().int().min(1).max(200),
  price_sgd: priceField,
})

const updateSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  num_sessions: z.number().int().min(1).max(200).optional(),
  price_sgd: priceField.optional(),
  status: statusEnum.optional(),
})

function serialize(r: svc.PtPackageRow) {
  return {
    id: r.id,
    name: r.name,
    session_type: r.sessionType,
    num_sessions: r.numSessions,
    price_sgd: r.priceSgd,
    status: r.status,
    archived_at: r.archivedAt,
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const rows = await svc.listPtPackages({ status: q.status, sessionType: q.session_type })
    return c.json({ pt_packages: rows.map(serialize) })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    return c.json(serialize(await svc.getPtPackage(id)))
  })
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const row = await svc.createPtPackage({
      name: body.name,
      sessionType: body.session_type,
      numSessions: body.num_sessions,
      priceSgd: body.price_sgd,
    })
    c.set('auditTarget' as any, { table: 'pt_packages', id: row.id })
    return c.json(serialize(row), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await svc.updatePtPackage(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.num_sessions !== undefined ? { numSessions: body.num_sessions } : {}),
      ...(body.price_sgd !== undefined ? { priceSgd: body.price_sgd } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    })
    c.set('auditTarget' as any, { table: 'pt_packages', id })
    return c.json(serialize(row))
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.archivePtPackage(id)
    c.set('auditTarget' as any, { table: 'pt_packages', id })
    return c.json(serialize(row))
  })

export default app
