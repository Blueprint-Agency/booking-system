/**
 * A Receipt as a PDF (#380, #386). **The one renderer**: the member's download,
 * the admin's download (#389) and the confirmation email's attachment (#387)
 * all call `receiptPdf`.
 *
 * Rendered on request and never stored. Everything it prints comes off the
 * Receipt's own snapshot, except the studio's display name and logo, which are
 * the studio's branding as of render (`tenant_settings`). Drawn in-process with
 * PDFKit, pure JavaScript: there is no browser on the host to print with.
 */
import PDFDocument from 'pdfkit'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { tenantSettings } from '../../db/schema/tenancy'
import { sgFormat } from '../../lib/time'
import { logger } from '../../shared/logger'
import { sgdText, toCents } from '../../shared/money'
import { cardBrandName, methodName } from '../finance/methods'
import type { ReceiptRow } from './issue'
import { studioLogo } from './logo'
import type { ReceiptPayment } from './snapshot'

/** How the studio looks on its Receipts today. */
interface Branding {
  name: string
  /** PNG or JPEG bytes, or null to show the name alone. */
  logo: Buffer | null
}

/** A Receipt, whole, as PDF bytes. */
export async function receiptPdf(receipt: ReceiptRow): Promise<Buffer> {
  return drawReceipt(receipt, await branding(receipt))
}

/** `R-000123.pdf`: what a downloaded or attached Receipt is called. */
export const receiptPdfFilename = (receipt: Pick<ReceiptRow, 'displayNumber'>): string =>
  `${receipt.displayNumber.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`

async function branding(receipt: ReceiptRow): Promise<Branding> {
  const [settings] = await db
    .select({ displayName: tenantSettings.displayName, logoUrl: tenantSettings.logoUrl })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, receipt.tenantId))
    .limit(1)
  return { name: settings?.displayName || receipt.sellerName, logo: await studioLogo(settings?.logoUrl ?? null) }
}

const day = sgFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const money = (sgd: string) => sgdText(toCents(sgd))

/**
 * How a payment was made, worded as the member's Receipt page words it
 * (fe-client `paymentLabel`): `Visa •••• 4242`, `Apple Pay · Visa •••• 4242`,
 * `PayNow`. The email's receipt block (./email.ts) words it the same.
 */
export const paymentLabel = (p: ReceiptPayment): string => {
  if (p.method === 'card' || p.cardBrand) {
    const card = [p.cardBrand ? cardBrandName(p.cardBrand) : 'Card', p.cardLast4 ? `•••• ${p.cardLast4}` : null]
      .filter(Boolean)
      .join(' ')
    return p.wallet ? `${methodName(p.wallet)} · ${card}` : card
  }
  return p.method ? methodName(p.method) : 'Online payment'
}

const INK = '#1a1a1a'
const MUTED = '#666666'
const RULE = '#dddddd'
const REFUNDED = '#b42318'

function drawReceipt(receipt: ReceiptRow, brand: Branding): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    // The Receipt's own date, not the moment it was drawn: the same Receipt
    // gives the same document.
    info: {
      Title: `Receipt ${receipt.displayNumber}`,
      Author: brand.name,
      CreationDate: receipt.issuedAt,
      ModDate: receipt.issuedAt,
    },
  })
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const left = doc.page.margins.left
  const width = doc.page.width - left - doc.page.margins.right
  const amountWidth = 110
  const rule = () => {
    doc.moveDown(0.6)
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.5).strokeColor(RULE).stroke()
    doc.moveDown(0.6)
  }
  /** A label on the left and an amount on the right, on one line. */
  const row = (label: string, amount: string, options: { bold?: boolean; color?: string; size?: number } = {}) => {
    const y = doc.y
    doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(options.size ?? 10).fillColor(options.color ?? INK)
    doc.text(label, left, y, { width: width - amountWidth - 10 })
    const after = doc.y
    doc.text(amount, left + width - amountWidth, y, { width: amountWidth, align: 'right' })
    doc.y = Math.max(after, doc.y)
    doc.x = left
  }

  // The studio, and the Receipt's number and date.
  const top = doc.y
  if (brand.logo) {
    try {
      doc.image(brand.logo, left, top, { fit: [160, 56] })
      doc.y = top + 64
    } catch (err) {
      // A JPEG PDFKit cannot read throws here, before anything is drawn: the name stands alone.
      logger.warn({ err, tenantId: receipt.tenantId }, 'studio logo could not be drawn on a receipt')
    }
  }
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(brand.name, left, doc.y, { width: width - 180 })
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
  for (const detail of [receipt.sellerLegalName, receipt.sellerRegistrationNumber, receipt.sellerAddress]) {
    if (detail) doc.text(detail, { width: width - 180 })
  }
  const studioBottom = doc.y

  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('RECEIPT', left + width - 170, top, { width: 170, align: 'right' })
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(receipt.displayNumber, { width: 170, align: 'right' })
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`Issued ${day.format(receipt.issuedAt)}`, { width: 170, align: 'right' })
  if (receipt.refundedAt) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(REFUNDED).text(`Refunded on ${day.format(receipt.refundedAt)}`, {
      width: 170,
      align: 'right',
    })
  }
  doc.y = Math.max(studioBottom, doc.y)
  doc.x = left
  rule()

  // Who it was issued to.
  if (receipt.buyerName || receipt.buyerEmail) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('ISSUED TO')
    if (receipt.buyerName) doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(receipt.buyerName)
    if (receipt.buyerEmail) doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(receipt.buyerEmail)
    rule()
  }

  // What was bought.
  for (const line of receipt.lines) {
    row(line.quantity > 1 ? `${line.description} x ${line.quantity}` : line.description, money(line.amountSgd), { bold: true })
    if (line.discounts.length > 0) {
      row(`List price ${money(line.listPriceSgd)}`, '', { color: MUTED, size: 9 })
      for (const discount of line.discounts) row(`${discount.label} -${money(discount.amountSgd)}`, '', { color: MUTED, size: 9 })
    }
    doc.moveDown(0.3)
  }
  rule()

  // The totals.
  row('Subtotal', money(receipt.subtotalSgd), { color: MUTED })
  if (toCents(receipt.discountSgd) > 0) row('Discount', `-${money(receipt.discountSgd)}`, { color: MUTED })
  doc.moveDown(0.2)
  row('Total paid', money(receipt.totalSgd), { bold: true, size: 12 })
  rule()

  // How it was paid.
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(receipt.payments.length === 1 ? 'PAYMENT' : 'PAYMENTS')
  doc.moveDown(0.2)
  if (receipt.payments.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor(INK).text('No payment: nothing was due.')
  } else {
    for (const payment of receipt.payments) {
      row(`${paymentLabel(payment)} · ${day.format(new Date(payment.paidAt))}`, money(payment.amountSgd))
    }
  }
  doc.moveDown(0.6)
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Status: ${receipt.refundedAt ? 'Refunded' : 'Issued'}`)

  if (receipt.sellerFooter) {
    rule()
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(receipt.sellerFooter)
  }

  doc.end()
  return finished
}
