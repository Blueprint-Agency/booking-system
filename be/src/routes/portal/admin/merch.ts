import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/catalog/merch'
import { BadRequestError } from '../../../shared/errors'

/**
 * Merch CRUD. The photo is its own call (POST /:id/image) so a file that is
 * refused never costs the item that was already saved.
 */

const idParam = z.object({ id: z.string().uuid() })

const priceField = z.union([z.string(), z.number()]).transform(v => {
  const n = typeof v === 'string' ? Number(v) : v
  if (!Number.isFinite(n) || n < 0) throw new Error('price must be a non-negative number')
  return n.toFixed(2)
})

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullish(),
  price_sgd: priceField,
})

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).nullish().optional(),
  price_sgd: priceField.optional(),
  archived: z.boolean().optional(),
})

const listQuery = z.object({
  include_archived: z.enum(['true', 'false', '1', '0']).optional(),
})

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const rows = await svc.listMerch({
      includeArchived: q.include_archived === 'true' || q.include_archived === '1',
    })
    return c.json({ merch: rows.map(svc.serializeMerch) })
  })
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const row = await svc.createMerch({
      title: body.title,
      description: body.description ?? null,
      priceSgd: body.price_sgd,
    })
    c.set('auditTarget' as any, { table: 'merch', id: row.id })
    return c.json(svc.serializeMerch(row), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await svc.updateMerch(id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.price_sgd !== undefined ? { priceSgd: body.price_sgd } : {}),
      ...(body.archived !== undefined ? { archivedAt: body.archived ? new Date() : null } : {}),
    })
    c.set('auditTarget' as any, { table: 'merch', id })
    return c.json(svc.serializeMerch(row))
  })
  .post(
    '/:id/image',
    bodyLimit({
      maxSize: svc.MERCH_IMAGE_MAX_BYTES,
      onError: c =>
        c.json(
          {
            error: 'image_too_large',
            message: `A merch photo can be at most ${svc.MERCH_IMAGE_MAX_BYTES / (1024 * 1024)}MB.`,
          },
          413,
        ),
    }),
    zValidator('param', idParam),
    async c => {
      const { id } = c.req.valid('param')
      const file = (await c.req.formData()).get('file')
      if (!file || typeof file === 'string') {
        throw new BadRequestError('image_required', {
          message: 'Attach a JPG, PNG or WebP image.',
        })
      }
      const row = await svc.setMerchImage({
        id,
        contentType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })
      c.set('auditTarget' as any, { table: 'merch', id })
      return c.json(svc.serializeMerch(row))
    },
  )
  .delete('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await svc.deleteMerch(id)
    c.set('auditTarget' as any, { table: 'merch', id })
    return c.body(null, 204)
  })

export default app
