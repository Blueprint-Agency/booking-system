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
 * The studio is the issuer, at the top of the page; the platform is credited
 * in the footer of every page, its mark drawn as shapes rather than an image.
 */
import PDFDocument from 'pdfkit'
import { logger } from '../../shared/logger'
import { receiptDocument, receiptStudio, type ReceiptDocument, type ReceiptFactLine, type ReceiptStudio } from './document'
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

/** The largest the studio's logo is drawn, beside its name. */
const LOGO_BOX = { width: 110, height: 46 }

/** PDFKit opens an image to measure it before drawing; its typings leave the method out. */
type OpensImages = { openImage(src: Buffer): { width: number; height: number } }

/**
 * `doc` laid out on A4. The studio's logo, PNG or JPEG bytes, sits beside its
 * name, or is left out when null. Every page ends with the platform's credit
 * and "R-000123 · Page 1 of 1", so a page printed on its own still says whose
 * it is.
 */
function drawReceipt(
  doc: ReceiptDocument,
  logo: Buffer | null,
  receipt: Pick<ReceiptRow, 'tenantId' | 'issuedAt'>,
): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: 'A4',
    margins: { top: 40, bottom: 80, left: 48, right: 48 },
    // Held until the end, so each page's footer can say how many pages there are.
    bufferPages: true,
    // The Receipt's own date, not the moment it was drawn: the same Receipt
    // gives the same document.
    info: {
      Title: `Receipt ${doc.number}`,
      Author: doc.studio.name,
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
  /** A small spaced capital label over a value: ISSUED TO, AMOUNT PAID. */
  const label = (text: string, x: number, y: number, w: number, align: 'left' | 'right' = 'left') =>
    font(true, 7.5, C.muted).text(text.toUpperCase(), x, y, { width: w, align, characterSpacing: 0.9, lineBreak: false })
  const rule = (y: number, from = left, to = right, weight = 0.6, color: string = C.rule) =>
    pdf.moveTo(from, y).lineTo(to, y).lineWidth(weight).strokeColor(color).stroke()
  /** Where to draw `height` more points: here, or the top of a new page when it will not fit. */
  const room = (y: number, height: number): number => {
    if (y + height <= pdf.page.height - pdf.page.margins.bottom) return y
    pdf.addPage()
    return pdf.page.margins.top
  }

  // The studio, and the Receipt's number.
  const top = pdf.page.margins.top
  // The number's column is as wide as the number, and the studio's name has the rest.
  const idWidth = Math.ceil(font(true, 19, C.ink).widthOfString(doc.number)) + 2
  let nameX = left
  let logoBottom = top
  if (logo) {
    try {
      const image = (pdf as unknown as OpensImages).openImage(logo)
      const scale = Math.min(LOGO_BOX.width / image.width, LOGO_BOX.height / image.height, 1)
      const w = image.width * scale
      const h = image.height * scale
      pdf.image(image as unknown as Buffer, left, top, { width: w, height: h })
      nameX = left + w + 12
      logoBottom = top + h
    } catch (err) {
      // A JPEG PDFKit cannot read throws here, before anything is drawn: the name stands alone.
      logger.warn({ err, tenantId: receipt.tenantId }, 'studio logo could not be drawn on a receipt')
    }
  }
  const nameWidth = right - idWidth - 16 - nameX
  font(true, 17, C.ink).text(doc.studio.name, nameX, top + 2, { width: nameWidth })
  if (doc.studio.details.length > 0) {
    font(false, 8.5, C.muted).text(doc.studio.details.join('\n'), nameX, pdf.y + 3, { width: nameWidth, lineGap: 1.5 })
  }
  const studioBottom = pdf.y

  font(true, 8.5, C.accent).text('RECEIPT', right - idWidth, top + 2, { width: idWidth, align: 'right', characterSpacing: 1.4 })
  font(true, 19, C.ink).text(doc.number, right - idWidth, top + 15, { width: idWidth, align: 'right' })
  const idBottom = pdf.y

  // The amount paid, and whether it still stands.
  const panelTop = Math.max(logoBottom, studioBottom, idBottom) + 22
  const panelHeight = 90
  pdf.roundedRect(left, panelTop, width, panelHeight, 7).fill(C.panel)
  let chipWidth = 0
  if (doc.chip) {
    const color = doc.chip.tone === 'paid' ? C.paid : C.refunded
    font(true, 8.5, color)
    chipWidth = pdf.widthOfString(doc.chip.text, { characterSpacing: 1 }) + 22
    const chipTop = panelTop + (panelHeight - 20) / 2
    pdf.roundedRect(right - 20 - chipWidth, chipTop, chipWidth, 20, 10).fill(doc.chip.tone === 'paid' ? C.paidGround : C.refundedGround)
    font(true, 8.5, color).text(doc.chip.text, right - 20 - chipWidth, chipTop + 6.5, {
      width: chipWidth,
      align: 'center',
      characterSpacing: 1,
      lineBreak: false,
    })
  }
  const panelText = width - 40 - (chipWidth ? chipWidth + 16 : 0)
  label('Amount paid', left + 20, panelTop + 17, panelText)
  font(true, 28, C.ink).text(doc.amountPaid, left + 20, panelTop + 31, { width: panelText, lineBreak: false })
  // Wrapped, not cut off: a wallet, a card and a refund on one line can be
  // wider than the space the chip leaves, and the panel has room for two.
  font(false, 9.5, C.muted).text(doc.refunded ? `${doc.status} · ` : doc.status, left + 20, panelTop + 64, {
    width: panelText,
    continued: doc.refunded !== null,
  })
  if (doc.refunded) font(true, 9.5, C.refunded).text(doc.refunded)

  // Issued to, Issued on, Paid with. The first takes what the others leave,
  // so a long email stays on one line.
  const factWidths: Partial<Record<ReceiptDocument['facts'][number]['key'], number>> = { issuedOn: 80, paidWith: 130 }
  const factLine = (line: ReceiptFactLine, x: number, y: number, w: number): number => {
    if (line.strong) font(true, 10, C.ink).text(line.text, x, y, { width: w })
    else font(false, 9.5, C.muted).text(line.text, x, y, { width: w })
    return pdf.y
  }
  const factsTop = panelTop + panelHeight + 22
  const factGap = 16
  const fixed = doc.facts.reduce((sum, f) => sum + (factWidths[f.key] ?? 0), 0)
  const rest = width - factGap * (doc.facts.length - 1) - fixed
  let factX = left
  let factsBottom = factsTop
  for (const fact of doc.facts) {
    const w = factWidths[fact.key] ?? rest
    label(fact.label, factX, factsTop, w)
    let y = factsTop + 12
    fact.lines.forEach((line, i) => {
      // A strong line after the first starts a group of its own: a second payment.
      if (line.strong && i > 0) y += 5
      y = factLine(line, factX, y, w) + (line.strong ? 2 : 0)
    })
    factsBottom = Math.max(factsBottom, y)
    factX += w + factGap
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
  const tableHead = (y: number): number => {
    label(doc.columns.description, left, y, descWidth)
    label(doc.columns.quantity, qtyX, y, qtyWidth, 'right')
    label(doc.columns.unitPrice, unitX, y, unitWidth, 'right')
    label(doc.columns.amount, amountX, y, amountWidth, 'right')
    rule(y + 14, left, right, 1.2, C.accent)
    return y + 14
  }
  let y = tableHead(factsBottom + 26)
  for (const line of doc.lines) {
    font(true, 10, C.ink)
    const height = pdf.heightOfString(line.description, { width: descWidth })
    const at = room(y, height + 20)
    if (at !== y) y = tableHead(at)
    font(true, 10, C.ink).text(line.description, left, y + 10, { width: descWidth })
    font(false, 10, C.ink)
    pdf.text(line.quantity, qtyX, y + 10, { width: qtyWidth, align: 'right' })
    pdf.text(line.unitPrice, unitX, y + 10, { width: unitWidth, align: 'right' })
    pdf.text(line.amount, amountX, y + 10, { width: amountWidth, align: 'right' })
    y += height + 20
    for (const discount of line.discounts) {
      font(false, 9, C.muted)
      const discountHeight = pdf.heightOfString(discount.label, { width: descWidth - 10 })
      const want = y - 6
      const at = room(want, discountHeight + 10)
      // A discount carried onto a new page goes under the table's headings, as a line does.
      y = at === want ? want : tableHead(at) + 8
      pdf.text(discount.label, left + 10, y, { width: descWidth - 10 })
      pdf.text(discount.amount, amountX, y, { width: amountWidth, align: 'right' })
      y += discountHeight + 10
    }
    rule(y)
  }

  // The totals.
  const totalsWidth = 230
  const totalsX = right - totalsWidth
  y = room(y + 14, 70)
  for (const total of doc.totals) {
    if (total.grand) {
      y += 3
      rule(y, totalsX, right, 1.2, C.ink)
      y += 9
    }
    const size = total.grand ? 12.5 : 10
    font(total.grand, size, total.grand ? C.ink : C.muted).text(total.label, totalsX, y, { width: totalsWidth / 2, lineBreak: false })
    pdf.text(total.amount, totalsX + totalsWidth / 2, y, { width: totalsWidth / 2, align: 'right', lineBreak: false })
    y += size + 6
  }

  // The studio's own note.
  if (doc.note) {
    font(false, 8.5, C.muted)
    const height = pdf.heightOfString(doc.note, { width, lineGap: 2 })
    y = room(y + 20, height + 13)
    rule(y)
    pdf.text(doc.note, left, y + 12, { width, lineGap: 2 })
  }

  // Every page: the band on top, the credit and the page count at the foot.
  const { start, count } = pdf.bufferedPageRange()
  for (let i = start; i < start + count; i++) {
    pdf.switchToPage(i)
    // Drawn below the bottom margin, where text would otherwise start a new page.
    const margin = pdf.page.margins.bottom
    pdf.page.margins.bottom = 0
    pdf.rect(0, 0, pdf.page.width, 6).fill(C.navy)
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
