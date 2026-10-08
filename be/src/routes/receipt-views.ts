import type { Context } from 'hono'
import { z } from 'zod'
import type { ReceiptRow } from '../services/receipts/issue'
import { receiptPdf, receiptPdfFilename } from '../services/receipts/pdf'
import { receiptStatus, type ReceiptSummary } from '../services/receipts/read'

/**
 * How a Receipt goes over the wire, to the member (`/me/receipts`, #384) and
 * to the studio's admins (`/portal/admin/receipts`, #389) alike: one shape and
 * one PDF, so the two can never show the same Receipt differently.
 */

/** A studio calendar day. */
export const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'a date like 2026-01-31' })

export const RECEIPTS_PAGE_SIZE_DEFAULT = 20
export const RECEIPTS_PAGE_SIZE_MAX = 100

/** The query every Receipts list takes: studio days, and the page. */
export const receiptsListQuery = z.object({
  from: plainDate.optional(),
  to: plainDate.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  page_size: z.coerce.number().int().min(1).max(RECEIPTS_PAGE_SIZE_MAX).default(RECEIPTS_PAGE_SIZE_DEFAULT),
})

export const receiptIdParam = z.object({ id: z.string().uuid() })

export const receiptSummaryView = (r: ReceiptSummary) => ({
  id: r.id,
  number: r.number,
  item: r.item,
  issued_at: r.issuedAt,
  total_sgd: r.totalSgd,
  status: r.status,
})

export const receiptView = (r: ReceiptRow) => ({
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

/** The Receipt as its PDF (#386), saved under its number. */
export async function receiptPdfResponse(c: Context, receipt: ReceiptRow): Promise<Response> {
  const bytes = await receiptPdf(receipt)
  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `attachment; filename="${receiptPdfFilename(receipt)}"`)
  c.header('Access-Control-Expose-Headers', 'Content-Disposition')
  c.header('Cache-Control', 'private, no-store')
  // Copied off Node's shared buffer pool, as the member export does.
  return c.newResponse(new Uint8Array(bytes))
}
