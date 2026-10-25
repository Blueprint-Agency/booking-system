import type { Context } from 'hono'
import { z } from 'zod'
import { receiptDocument, receiptStudio } from '../services/receipts/document'
import { receiptHtmlPage } from '../services/receipts/html'
import type { ReceiptRow } from '../services/receipts/issue'
import { receiptPdf, receiptPdfFilename } from '../services/receipts/pdf'
import { receiptStatus, type ReceiptSummary } from '../services/receipts/read'
import { explainInvalid } from './explain-invalid'
import { plainDate } from './plain-date'

/** A Receipts filter refused for its shape, answered with the field's sentence. */
export const explainReceiptsQuery = explainInvalid('That Receipts filter is not valid.')

/**
 * How a Receipt goes over the wire, to the member (`/me/receipts`, #384) and
 * to the studio's admins (`/portal/admin/receipts`, #389) alike: one shape,
 * one HTML and one PDF, so the two can never show the same Receipt differently.
 */


const RECEIPTS_PAGE_SIZE_DEFAULT = 20
const RECEIPTS_PAGE_SIZE_MAX = 100

/** The query every Receipts list takes: studio days, and the page. */
export const receiptsListQuery = z.object({
  from: plainDate('A from date').optional(),
  to: plainDate('A to date').optional(),
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

const receiptView = (r: ReceiptRow) => ({
  id: r.id,
  number: r.displayNumber,
  kind: r.kind,
  issued_at: r.issuedAt,
  status: receiptStatus(r),
  refunded_at: r.refundedAt,
  seller: {
    name: r.sellerName,
    business_name: r.sellerBusinessName,
    registration_number: r.sellerRegistrationNumber,
    address: r.sellerAddress,
    footer: r.sellerFooter,
    // The studio's contact email as of issue (#403), or null.
    email: r.sellerEmail,
  },
  buyer: { name: r.buyerName, email: r.buyerEmail },
  // Who the Purchase was billed to (#401), or null where it chose no Billing details.
  // Its fields are already the wire's: name, line1, line2, city, state, postcode, country.
  bill_to: r.billTo,
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

/**
 * One Receipt, whole: its fields, and `html`, the Receipt drawn as a page of
 * its own. Both apps show the `html` rather than lay the fields out, so the
 * Receipt reads on their pages exactly as in the email and the PDF.
 */
export async function receiptDetailView(r: ReceiptRow) {
  return { ...receiptView(r), html: receiptHtmlPage(receiptDocument(r, await receiptStudio(r))) }
}

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
