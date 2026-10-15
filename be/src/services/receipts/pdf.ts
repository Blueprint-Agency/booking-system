/**
 * A Receipt as a PDF (#380, #386). **The one PDF renderer**: the member's
 * download, the admin's download (#389) and the confirmation email's
 * attachment (#387) all call `receiptPdf`.
 *
 * It lays out `receiptDocument` in `RECEIPT_COLORS`, the same document and
 * colours `html.ts` draws for the email and both apps' Receipt pages, so
 * nothing here words or orders anything of its own. Rendered on request and
 * never stored. Drawn in-process with PDFKit, pure JavaScript: there is no
 * browser on the host to print with.
 *
 * Laid out as a business receipt (#403): the title with the studio's logo, or
 * its Business name, on the right; the facts; the studio and Bill to side by
 * side; what was paid and when; the lines; the totals; the Payment history.
 * The lines and the Payment history break across pages, their headings
 * repeated, so no number of either overflows one. The platform is credited in
 * the footer of every page, its mark drawn as shapes rather than an image.
 */
import PDFDocument from 'pdfkit'
import { logger } from '../../shared/logger'
import { receiptDocument, receiptStudio, type ReceiptBlockLine, type ReceiptDocument, type ReceiptStudio } from './document'
import type { ReceiptRow } from './issue'
import { studioLogo } from './logo'
import { MARK_BODY_PATH, RECEIPT_COLORS as C } from './theme'

/** A Receipt, whole, as PDF bytes. `studio` when the caller has already read it. */
export async function receiptPdf(receipt: ReceiptRow, studio?: ReceiptStudio): Promise<Buffer> {
  studio ??= await receiptStudio(receipt)
  return drawReceipt(receiptDocument(receipt, studio), await studioLogo(studio.logoUrl), receipt)
}

/** `R-000123.pdf`: what a downloaded or attached Receipt is called. */
export const receiptPdfFilename = (receipt: Pick<ReceiptRow, 'displayNumber'>): string =>
  `${receipt.displayNumber.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`

/** The largest the studio's logo is drawn, top right. */
const LOGO_BOX = { width: 150, height: 48 }

/** PDFKit opens an image to measure it before drawing; its typings leave the method out. */
type OpensImages = { openImage(src: Buffer): { width: number; height: number } }

/**
 * `doc` laid out on A4. The studio's logo, PNG or JPEG bytes, sits top right,
 * or its Business name does when the logo is null or cannot be drawn. Every
 * page ends with the platform's credit and "R-000123 · Page 1 of 1", so a page
 * printed on its own still says whose it is.
 */
function drawReceipt(
  doc: ReceiptDocument,
  logo: Buffer | null,
  receipt: Pick<ReceiptRow, 'tenantId' | 'issuedAt'>,
): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 80, left: 48, right: 48 },
    // Held until the end, so each page's footer can say how many pages there are.
    bufferPages: true,
    // The Receipt's own date, not the moment it was drawn: the same Receipt
    // gives the same document.
    info: {
      Title: `Receipt ${doc.number}`,
      Author: doc.sellerName,
      Creator: doc.credit.name,
      Producer: doc.credit.name,
      CreationDate: receipt.issuedAt,
      ModDate: receipt.issuedAt,
    },
  })
  const chunks: Buffer[] = []
  pdf.on('data', (chunk: Buffer) => chunks.push(chunk))
  const finished = new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)
  })

  const left = pdf.page.margins.left
  const right = pdf.page.width - pdf.page.margins.right
  const width = right - left

  const font = (bold: boolean, size: number, color: string) =>
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color)
  /** A table's column heading, small and muted, in the words a reader copies out of it. */
  const label = (text: string, x: number, y: number, w: number, align: 'left' | 'right' = 'left') =>
    font(false, 8.5, C.muted).text(text, x, y, { width: w, align, lineBreak: false })
  const rule = (y: number, from = left, to = right, weight = 0.6, color: string = C.rule) =>
    pdf.moveTo(from, y).lineTo(to, y).lineWidth(weight).strokeColor(color).stroke()
  /** Where to draw `height` more points: here, or the top of a new page when it will not fit. */
  const room = (y: number, height: number): number => {
    if (y + height <= pdf.page.height - pdf.page.margins.bottom) return y
    pdf.addPage()
    return pdf.page.margins.top
  }
  /**
   * One line of text that never wraps: set at `size`, or smaller, down to a
   * floor, where it would not fit `w`. An email or a name stays one run, as a
   * reader copying it out of the PDF needs it.
   */
  const oneLine = (text: string, x: number, y: number, w: number, bold: boolean, size: number, color: string, align: 'left' | 'right' = 'left') => {
    font(bold, size, color)
    // A little under the exact fit: PDFKit wraps a line that measures its width to the hair.
    const fits = Math.max(6.5, Math.min(size, (size * w * 0.97) / Math.max(1, pdf.widthOfString(text))))
    font(bold, fits, color).text(text, x, y + (size - fits) / 2, { width: w, align, lineBreak: false })
    return y + size * 1.45
  }

  // The title, and the studio's logo or its Business name on the right.
  const top = pdf.page.margins.top
  font(true, 26, C.ink).text(doc.title, left, top, { lineBreak: false })
  const titleBottom = top + 34
  let brandBottom = top
  let drawn = false
  if (logo) {
    try {
      const image = (pdf as unknown as OpensImages).openImage(logo)
      const scale = Math.min(LOGO_BOX.width / image.width, LOGO_BOX.height / image.height, 1)
      const w = image.width * scale
      const h = image.height * scale
      pdf.image(image as unknown as Buffer, right - w, top, { width: w, height: h })
      brandBottom = top + h
      drawn = true
    } catch (err) {
      // A JPEG PDFKit cannot read throws here, before anything is drawn: the name stands in its place.
      logger.warn({ err, tenantId: receipt.tenantId }, 'studio logo could not be drawn on a receipt')
    }
  }
  if (!drawn) brandBottom = oneLine(doc.sellerName, right - 260, top + 4, 260, true, 13, C.ink, 'right')

  // The facts: a label and its value a row.
  let y = Math.max(titleBottom, brandBottom) + 14
  for (const fact of doc.facts) {
    font(false, 9.5, C.muted).text(fact.label, left, y, { width: 100, lineBreak: false })
    oneLine(fact.value, left + 104, y, width / 2 - 104, false, 9.5, C.ink)
    y += 15
  }

  // The studio, and Bill to, side by side.
  const gutter = 24
  const columnWidth = (width - gutter) / 2
  const block = (lines: ReceiptBlockLine[], x: number, from: number): number => {
    let at = from
    for (const line of lines) at = oneLine(line.text, x, at, columnWidth, line.strong, 9.5, line.strong ? C.ink : C.muted) - 1.5
    return at
  }
  const partiesTop = y + 18
  const sellerBottom = block(doc.seller, left, partiesTop)
  const billBottom = block(
    [{ text: doc.billTo.label, strong: true }, ...doc.billTo.lines.map(line => ({ ...line, strong: false }))],
    left + columnWidth + gutter,
    partiesTop,
  )

  // What was paid and when, its marker beside it, and the Refund.
  y = Math.max(sellerBottom, billBottom) + 22
  font(true, 18, C.ink).text(doc.headline, left, y, { lineBreak: false })
  const headlineWidth = pdf.widthOfString(doc.headline)
  if (doc.chip) {
    const color = doc.chip.tone === 'paid' ? C.paid : C.refunded
    font(true, 7.5, color)
    // Unspaced, so the marker copies out of the PDF as the word it is.
    const chipWidth = pdf.widthOfString(doc.chip.text) + 16
    const chipX = left + headlineWidth + 10
    pdf.roundedRect(chipX, y + 2, chipWidth, 15, 7.5).fill(doc.chip.tone === 'paid' ? C.paidGround : C.refundedGround)
    font(true, 7.5, color).text(doc.chip.text, chipX, y + 6, { width: chipWidth, align: 'center', lineBreak: false })
  }
  y += 26
  if (doc.refunded) {
    font(true, 10, C.refunded).text(doc.refunded, left, y, { lineBreak: false })
    y += 16
  }

  // What was bought.
  const qtyWidth = 34
  const unitWidth = 80
  const amountWidth = 80
  const cellGap = 14
  const amountX = right - amountWidth
  const unitX = amountX - cellGap - unitWidth
  const qtyX = unitX - cellGap - qtyWidth
  const descWidth = qtyX - cellGap - left
  const tableHead = (at: number): number => {
    label(doc.columns.description, left, at, descWidth)
    label(doc.columns.quantity, qtyX, at, qtyWidth, 'right')
    label(doc.columns.unitPrice, unitX, at, unitWidth, 'right')
    label(doc.columns.amount, amountX, at, amountWidth, 'right')
    rule(at + 13, left, right, 0.8, C.ink)
    return at + 13
  }
  y = tableHead(y + 14)
  for (const line of doc.lines) {
    font(false, 10, C.ink)
    const height = pdf.heightOfString(line.description, { width: descWidth })
    const at = room(y, height + 18)
    if (at !== y) y = tableHead(at)
    font(false, 10, C.ink).text(line.description, left, y + 9, { width: descWidth })
    pdf.text(line.quantity, qtyX, y + 9, { width: qtyWidth, align: 'right' })
    pdf.text(line.unitPrice, unitX, y + 9, { width: unitWidth, align: 'right' })
    pdf.text(line.amount, amountX, y + 9, { width: amountWidth, align: 'right' })
    y += height + 18
    for (const discount of line.discounts) {
      font(false, 9, C.muted)
      const discountHeight = pdf.heightOfString(discount.label, { width: descWidth - 10 })
      const want = y - 5
      const at = room(want, discountHeight + 10)
      // A discount carried onto a new page goes under the table's headings, as a line does.
      y = at === want ? want : tableHead(at) + 8
      pdf.text(discount.label, left + 10, y, { width: descWidth - 10 })
      pdf.text(discount.amount, amountX, y, { width: amountWidth, align: 'right' })
      y += discountHeight + 10
    }
    rule(y)
  }

  // The totals, each on a rule, ending in Amount paid.
  const totalsWidth = 250
  const totalsX = right - totalsWidth
  y = room(y + 4, doc.totals.length * 24)
  doc.totals.forEach((total, i) => {
    if (i > 0) rule(y, totalsX, right)
    const size = total.strong ? 11 : 10
    font(total.strong, size, C.ink).text(total.label, totalsX, y + 7, { width: totalsWidth / 2, lineBreak: false })
    pdf.text(total.amount, totalsX + totalsWidth / 2, y + 7, { width: totalsWidth / 2, align: 'right', lineBreak: false })
    y += size + 13
  })

  // The Payment history: every payment, however many, its headings carried onto each page it runs to.
  if (doc.payments) {
    const history = doc.payments
    const dateWidth = 90
    const payAmountX = amountX
    const dateX = payAmountX - cellGap - dateWidth
    const methodWidth = dateX - cellGap - left
    const historyHead = (at: number): number => {
      label(history.columns.method, left, at, methodWidth)
      label(history.columns.date, dateX, at, dateWidth)
      label(history.columns.amount, payAmountX, at, amountWidth, 'right')
      rule(at + 13, left, right, 0.8, C.ink)
      return at + 13
    }
    y = room(y + 26, 16 + 13 + 24)
    font(true, 12, C.ink).text(history.title, left, y, { lineBreak: false })
    y = historyHead(y + 22)
    for (const payment of history.rows) {
      const at = room(y, 24)
      if (at !== y) y = historyHead(at)
      oneLine(payment.method, left, y + 7, methodWidth, false, 10, C.ink)
      font(false, 10, C.ink).text(payment.date, dateX, y + 7, { width: dateWidth, lineBreak: false })
      pdf.text(payment.amount, payAmountX, y + 7, { width: amountWidth, align: 'right', lineBreak: false })
      y += 24
      rule(y)
    }
  }

  // The studio's own note.
  if (doc.note) {
    font(false, 8.5, C.muted)
    const height = pdf.heightOfString(doc.note, { width, lineGap: 2 })
    y = room(y + 26, height)
    pdf.text(doc.note, left, y, { width, lineGap: 2 })
  }

  // Every page: the credit and the page count at the foot.
  const { start, count } = pdf.bufferedPageRange()
  for (let i = start; i < start + count; i++) {
    pdf.switchToPage(i)
    // Drawn below the bottom margin, where text would otherwise start a new page.
    const margin = pdf.page.margins.bottom
    pdf.page.margins.bottom = 0
    const footTop = pdf.page.height - 44
    rule(footTop)
    drawMark(pdf, left, footTop + 9, 14)
    font(false, 8, C.muted).text('Powered by ', left + 21, footTop + 12.5, { continued: true, lineBreak: false })
    font(true, 8, C.ink).text(doc.credit.name, { continued: true, lineBreak: false })
    font(false, 8, C.muted).text(` · ${doc.credit.site}`, { lineBreak: false })
    font(false, 8, C.muted).text(`${doc.number} · Page ${i - start + 1} of ${count}`, right - 200, footTop + 12.5, {
      width: 200,
      align: 'right',
      lineBreak: false,
    })
    pdf.page.margins.bottom = margin
  }

  pdf.end()
  return finished
}

/** The platform's mark, `size` points square, drawn as shapes so no image is embedded. */
function drawMark(pdf: PDFKit.PDFDocument, x: number, y: number, size: number) {
  pdf.save()
  pdf.translate(x, y).scale(size / 64)
  pdf.roundedRect(0, 0, 64, 64, 14).fill(C.navy)
  pdf.path(MARK_BODY_PATH).fill(C.markLight)
  pdf.roundedRect(26, 24, 12, 3.2, 1.6).fill(C.navy)
  pdf.roundedRect(26, 31, 12, 3.2, 1.6).fill(C.navy)
  pdf.restore()
}
