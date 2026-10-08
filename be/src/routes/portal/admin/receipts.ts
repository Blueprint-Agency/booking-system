import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { purchaseKindEnum } from '../../../db/enums'
import { tenantId } from '../../../middleware/tenant'
import { receiptsCsv } from '../../../services/receipts/csv'
import {
  exportStudioReceipts,
  listStudioReceipts,
  studioReceipt,
  type StudioReceiptSummary,
} from '../../../services/receipts/read'
import { resendReceipt } from '../../../services/receipts/resend'
import { receiptIdParam, receiptPdfResponse, receiptSummaryView, receiptsListQuery, receiptView } from '../../receipt-views'

/**
 * Every Receipt in the studio, for its admins (#389): `GET /`, searched by
 * `?q` (receipt number, buyer name or email), narrowed by `?from&to` (studio
 * days), `?kind` and `?status`; `GET /export.csv`, the same list as a file
 * (#390); `GET /:id`; `GET /:id/pdf`; and `POST /:id/resend` (#390). One Receipt
 * reads and downloads exactly as the member sees it: the shapes and the PDF
 * are the member routes' own (`receipt-views.ts`). Another studio's Receipt is
 * `404 receipt_not_found`. Instructors are refused by the admin subtree's gate.
 */

const listQuery = receiptsListQuery.extend({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(purchaseKindEnum.enumValues).optional(),
  status: z.enum(['issued', 'refunded']).optional(),
})

/** The list's search and filters, without its page. */
const exportQuery = listQuery.omit({ page: true, page_size: true })

const studioSummaryView =(r: StudioReceiptSummary) => ({
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
  // The list as a file for the bookkeeper (#390): the same filters, every page.
  // Mounted before `/:id`, which would read `export.csv` as an id.
  .get('/export.csv', zValidator('query', exportQuery), async c => {
    const q = c.req.valid('query')
    const rows = await exportStudioReceipts(tenantId(c), { q: q.q, from: q.from, to: q.to, kind: q.kind, status: q.status })
    return c.body(receiptsCsv(rows), 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="receipts.csv"',
      'Access-Control-Expose-Headers': 'Content-Disposition',
      'Cache-Control': 'private, no-store',
    })
  })
  .get('/:id', zValidator('param', receiptIdParam), async c => {
    const receipt = await studioReceipt(tenantId(c), c.req.valid('param').id)
    return c.json(receiptView(receipt))
  })
  .get('/:id/pdf', zValidator('param', receiptIdParam), async c => {
    const receipt = await studioReceipt(tenantId(c), c.req.valid('param').id)
    return receiptPdfResponse(c, receipt)
  })
  // The purchase's own email again, Receipt and PDF with it, to the member's
  // current address (#390). `409 receipt_member_deleted` once they are gone.
  // The service files the one `receipt_resent` row naming the admin.
  .post('/:id/resend', zValidator('param', receiptIdParam), async c => {
    const { id } = c.req.valid('param')
    const sent = await resendReceipt({ tenantId: tenantId(c), receiptId: id, actorStaffId: c.get('staffUserId') })
    c.set('auditFiled' as any, true)
    return c.json({ sent_to: sent.sentTo })
  })

export default app
