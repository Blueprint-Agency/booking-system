import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { tenantId } from '../../middleware/tenant'
import { listMemberReceipts, memberReceipt } from '../../services/receipts/read'
import { receiptDetailView, receiptIdParam, receiptPdfResponse, receiptSummaryView, receiptsListQuery } from '../receipt-views'

/**
 * The member's Receipts (#384): `GET /me/receipts`, `GET /me/receipts/:id`,
 * and `GET /me/receipts/:id/pdf`, the same Receipt as a PDF (#386).
 * Only ever the member's own, at this studio; anything else is
 * `404 receipt_not_found`. The shapes are the admin's too (`receipt-views.ts`).
 */

const app = new Hono()
  .get('/', zValidator('query', receiptsListQuery), async c => {
    const q = c.req.valid('query')
    const result = await listMemberReceipts(tenantId(c), c.get('clientId'), {
      from: q.from,
      to: q.to,
      page: q.page,
      pageSize: q.page_size,
    })
    return c.json({ receipts: result.rows.map(receiptSummaryView), total: result.total, page: q.page, page_size: q.page_size })
  })
  .get('/:id', zValidator('param', receiptIdParam), async c => {
    const receipt = await memberReceipt(tenantId(c), c.get('clientId'), c.req.valid('param').id)
    return c.json(await receiptDetailView(receipt))
  })
  .get('/:id/pdf', zValidator('param', receiptIdParam), async c => {
    const receipt = await memberReceipt(tenantId(c), c.get('clientId'), c.req.valid('param').id)
    return receiptPdfResponse(c, receipt)
  })

export default app
