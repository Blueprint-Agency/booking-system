import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/packages/promo-code-admin'
import { tenantId } from '../../../middleware/tenant'

const productTypeEnum = z.enum(['class_package', 'pt_package', 'workshop'])
const statusEnum = z.enum(['active', 'archived'])

const amountField = z.union([z.string(), z.number()]).transform(v => {
  const n = typeof v === 'string' ? Number(v) : v
  if (!Number.isFinite(n) || n <= 0) throw new Error('amount must be a positive number')
  return n.toFixed(2)
})

const idParam = z.object({ id: z.string().uuid() })
const listQuery = z.object({ status: statusEnum.optional() })

const productSchema = z.object({
  product_type: productTypeEnum,
  product_id: z.string().uuid(),
})

const createSchema = z.object({
  // Omitted → generated from the unambiguous alphabet.
  code: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(160),
  kind: z.enum(['percent', 'amount']),
  percent_off: z.number().int().min(1).max(99).nullish(),
  amount_off_sgd: amountField.nullish(),
  max_redemptions: z.number().int().min(1).nullish(),
  expires_at: z.string().datetime({ offset: true }).nullish(),
  applies_to_all: z.boolean(),
  products: z.array(productSchema).default([]),
})

// `code` and the money-off fields are accepted only while the code has no
// Redemption; the service refuses them after that (409 promo_code_terms_frozen)
// rather than rewriting terms a member has accepted.
const updateSchema = z.object({
  label: z.string().min(1).max(160).optional(),
  max_redemptions: z.number().int().min(1).nullish(),
  expires_at: z.string().datetime({ offset: true }).nullish(),
  applies_to_all: z.boolean().optional(),
  products: z.array(productSchema).optional(),
  code: z.string().min(1).max(64).optional(),
  kind: z.enum(['percent', 'amount']).optional(),
  percent_off: z.number().int().min(1).max(99).nullish(),
  amount_off_sgd: amountField.nullish(),
})

function toProductRefs(products: z.infer<typeof productSchema>[]) {
  return products.map(p => ({ productType: p.product_type, productId: p.product_id }))
}

function serialize(d: svc.PromoCodeDetail) {
  return {
    id: d.code.id,
    code: d.code.code,
    label: d.code.label,
    kind: d.code.kind,
    percent_off: d.code.percentOff,
    amount_off_sgd: d.code.amountOffSgd,
    max_redemptions: d.code.maxRedemptions,
    expires_at: d.code.expiresAt,
    applies_to_all: d.code.appliesToAll,
    status: d.code.status,
    products: d.products.map(p => ({
      product_type: p.productType,
      product_id: p.productId,
    })),
    // Redemptions a member actually took. A live Hold is not one of them, so a
    // code being claimed right now can read one short of its places — that
    // settles itself when the checkout completes or the Hold lapses.
    redemption_count: d.consumedCount,
    // Once a member has accepted these terms the code text and the money off
    // stop being editable.
    terms_frozen: d.consumedCount > 0,
    created_at: d.code.createdAt,
    updated_at: d.code.updatedAt,
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    return c.json({ promo_codes: (await svc.listPromoCodes(tenantId(c), q)).map(serialize) })
  })
  // Registered before /:id so "products" is not parsed as a uuid.
  .get('/products', async c => {
    const rows = await svc.listScopableProducts(tenantId(c))
    return c.json({
      products: rows.map(r => ({
        product_type: r.productType,
        product_id: r.productId,
        name: r.name,
      })),
    })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    return c.json(serialize(await svc.getPromoCode(tenantId(c), id)))
  })
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const detail = await svc.createPromoCode(
      tenantId(c),
      {
        code: body.code ?? null,
        label: body.label,
        kind: body.kind,
        percentOff: body.percent_off ?? null,
        amountOffSgd: body.amount_off_sgd ?? null,
        maxRedemptions: body.max_redemptions ?? null,
        expiresAt: body.expires_at ? new Date(body.expires_at) : null,
        appliesToAll: body.applies_to_all,
        products: toProductRefs(body.products),
      },
      c.get('staffUserId'),
    )
    c.set('auditTarget' as any, { table: 'promo_codes', id: detail.code.id })
    return c.json(serialize(detail), 201)
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const detail = await svc.updatePromoCode(tenantId(c), id, {
      ...(body.code !== undefined ? { code: body.code } : {}),
      ...(body.kind !== undefined
        ? {
            kind: body.kind,
            percentOff: body.percent_off ?? null,
            amountOffSgd: body.amount_off_sgd ?? null,
          }
        : {}),
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.max_redemptions !== undefined
        ? { maxRedemptions: body.max_redemptions ?? null }
        : {}),
      ...(body.expires_at !== undefined
        ? { expiresAt: body.expires_at ? new Date(body.expires_at) : null }
        : {}),
      ...(body.applies_to_all !== undefined ? { appliesToAll: body.applies_to_all } : {}),
      ...(body.products !== undefined ? { products: toProductRefs(body.products) } : {}),
    })
    c.set('auditTarget' as any, { table: 'promo_codes', id })
    return c.json(serialize(detail))
  })
  // Archive only — §11 gives one direction. There is no un-archive.
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const detail = await svc.archivePromoCode(tenantId(c), id)
    c.set('auditTarget' as any, { table: 'promo_codes', id })
    return c.json(serialize(detail))
  })

export default app
