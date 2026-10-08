import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { tenantId } from '../../middleware/tenant'
import { listMemberReceipts, memberReceipt, receiptStatus, type ReceiptSummary } from '../../services/receipts/read'
import type { ReceiptRow } from '../../services/receipts/issue'

/**
 * The member's Receipts (#384): `GET /me/receipts` and `GET /me/receipts/:id`.
 * Only ever the member's own, at this studio; anything else is
 * `404 receipt_not_found`.
 */

const RECEIPTS_PAGE_SIZE_DEFAULT = 20
const RECEIPTS_PAGE_SIZE_MAX = 100

/** A studio calendar day. */
const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'a date like 2026-01-31' })

const listQuery = z.object({
  from: plainDate.optional(),
  to: plainDate.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  page_size: z.coerce.number().int().min(1).max(RECEIPTS_PAGE_SIZE_MAX).default(RECEIPTS_PAGE_SIZE_DEFAULT),
})

const idParam = z.object({ id: z.string().uuid() })

const summaryView = (r: ReceiptSummary) => ({
  id: r.id,
  number: r.number,
  item: r.item,
  issued_at: r.issuedAt,
  total_sgd: r.totalSgd,
  status: r.status,
})

const receiptView = (r: ReceiptRow) => ({
  id: r.id,
  number: r.displayNumber,
  kind: r.kind,
  issued_at: r.issuedAt,
  status: receiptStatus(r),
  refunded_at: r.refundedAt,
  seller: {
    name: r.sellerName,
    legal_name: r.sellerLegalName,
    registration_number: r.sellerRegistrationNumber,
    address: r.sellerAddress,
    footer: r.sellerFooter,
  },
  buyer: { name: r.buyerName, email: r.buyerEmail },
  lines: r.lines.map(l => ({
    description: l.description,
    quantity: l.quantity,
    list_price_sgd: l.listPriceSgd,
    discount_sgd: l.discountSgd,
    discounts: l.discounts.map(d => ({ source: d.source, label: d.label, amount_sgd: d.amountSgd })),
    amount_sgd: l.amountSgd,
  })),
  subtotal_sgd: r.subtotalSgd,
  discount_sgd: r.discountSgd,
  total_sgd: r.totalSgd,
  payments: r.payments.map(p => ({
    method: p.method,
    card_brand: p.cardBrand,
    card_last4: p.cardLast4,
    wallet: p.wallet,
    amount_sgd: p.amountSgd,
    paid_at: p.paidAt,
  })),
})

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const result = await listMemberReceipts(tenantId(c), c.get('clientId'), {
      from: q.from,
      to: q.to,
      page: q.page,
      pageSize: q.page_size,
    })
    return c.json({ receipts: result.rows.map(summaryView), total: result.total, page: q.page, page_size: q.page_size })
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const receipt = await memberReceipt(tenantId(c), c.get('clientId'), c.req.valid('param').id)
    return c.json(receiptView(receipt))
  })

export default app
