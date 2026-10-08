import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { purchaseKindEnum } from '../../../db/enums'
import { tenantId } from '../../../middleware/tenant'
import { listStudioReceipts, studioReceipt, type StudioReceiptSummary } from '../../../services/receipts/read'
import { receiptIdParam, receiptPdfResponse, receiptSummaryView, receiptsListQuery, receiptView } from '../../receipt-views'

/**
 * Every Receipt in the studio, for its admins (#389): `GET /`, searched by
 * `?q` (receipt number, buyer name or email), narrowed by `?from&to` (studio
 * days), `?kind` and `?status`; `GET /:id`; and `GET /:id/pdf`. One Receipt
 * reads and downloads exactly as the member sees it: the shapes and the PDF
 * are the member routes' own (`receipt-views.ts`). Another studio's Receipt is
 * `404 receipt_not_found`. Instructors are refused by the admin subtree's gate.
 */

const listQuery = receiptsListQuery.extend({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(purchaseKindEnum.enumValues).optional(),
  status: z.enum(['issued', 'refunded']).optional(),
})

const studioSummaryView = (r: StudioReceiptSummary) => ({
  ...receiptSummaryView(r),
  kind: r.kind,
  client_id: r.clientId,
  buyer_name: r.buyerName,
  buyer_email: r.buyerEmail,
})

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const result = await listStudioReceipts(tenantId(c), {
      q: q.q,
      from: q.from,
      to: q.to,
      kind: q.kind,
      status: q.status,
      page: q.page,
      pageSize: q.page_size,
    })
    return c.json({ receipts: result.rows.map(studioSummaryView), total: result.total, page: q.page, page_size: q.page_size })
  })
  .get('/:id', zValidator('param', receiptIdParam), async c => {
    const receipt = await studioReceipt(tenantId(c), c.req.valid('param').id)
    return c.json(receiptView(receipt))
  })
  .get('/:id/pdf', zValidator('param', receiptIdParam), async c => {
    const receipt = await studioReceipt(tenantId(c), c.req.valid('param').id)
    return receiptPdfResponse(c, receipt)
  })

export default app
