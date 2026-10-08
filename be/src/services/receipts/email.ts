/**
 * A Receipt in an email (#380, #387): the itemised block under the studio's
 * copy, the PDF attached, and the two template variables that name it.
 *
 * **The one way any email carries a Receipt.** The four purchase confirmations
 * call `withReceipt`, and so do the `purchase_receipt` email for Merch and a
 * standalone Cross-Location Add-On (#388) and an admin's resend (#390), so a
 * Receipt reads the same in every inbox.
 *
 * The block is markup the backend builds, so it cannot be a template variable:
 * the renderer HTML-escapes every value it substitutes. It goes in the frame
 * instead (`SendInput.appendixHtml`), under the studio's own body, which stays
 * the studio's to word and needs no editing for the block to appear. Every
 * value printed in it is escaped here.
 */
import type { MailAttachment } from '../../lib/mailer'
import { sgFormat } from '../../lib/time'
import { sgdText, toCents } from '../../shared/money'
import { EMAIL_COLORS, escapeHtml } from '../mail/layout'
import type { SendInput } from '../notifications/send'
import { requireTenantUrl } from '../tenants/urls'
import type { ReceiptRow } from './issue'
import { paymentLabel, receiptPdf, receiptPdfFilename } from './pdf'

const C = EMAIL_COLORS
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const day = sgFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const money = (sgd: string) => sgdText(toCents(sgd))

/** The member's Receipt in their own studio's booking app. */
export async function receiptPageUrl(tenantId: string, receiptId: string): Promise<string> {
  return `${await requireTenantUrl('client', tenantId)}/account/receipts/${receiptId}`
}

/** The Receipt as a file to attach: its PDF, named after its number (`R-000123.pdf`). */
export async function receiptAttachment(receipt: ReceiptRow): Promise<MailAttachment> {
  return { filename: receiptPdfFilename(receipt), contentType: 'application/pdf', content: await receiptPdf(receipt) }
}

/**
 * One row of the block: a label and an amount. The label cell is tagged so
 * the plain-text alternative reads "Ten pack: S$150.00".
 */
function row(label: string, amount: string, style: 'line' | 'detail' | 'total', first = false): string {
  const border = first ? '' : `border-top:1px solid ${C.border};`
  const size = style === 'detail' ? 13 : 15
  const weight = style === 'detail' ? 400 : 600
  const color = style === 'detail' ? C.muted : C.ink
  const cell = `padding:8px 16px;${style === 'detail' ? '' : border}font-family:${FONT};font-size:${size}px;line-height:1.5;font-weight:${weight};color:${color};`
  return `  <tr>
    <td data-text="label" valign="top" style="${cell}">${label}</td>
    <td valign="top" align="right" style="${cell}text-align:right;white-space:nowrap;">${amount}</td>
  </tr>`
}

/**
 * The Receipt, itemised, as an email body fragment: its number and date, each
 * line at what the member paid for it with what a Promotion or Promo Code took
 * off it, the total paid, how it was paid, and a Refunded stamp when its
 * Purchase has been refunded. Read off the Receipt's own snapshot, as the PDF
 * and the Receipt page are. Pure.
 *
 * Every figure in it is one the member paid or was given off. The List Price
 * and the subtotal before discounts are on the attached PDF, not here: beside
 * the studio's "Amount paid" an undiscounted figure reads as the charge.
 */
export function receiptEmailBlock(receipt: ReceiptRow): string {
  const rows: string[] = []
  receipt.lines.forEach((line, i) => {
    const description = line.quantity > 1 ? `${line.description} x ${line.quantity}` : line.description
    rows.push(row(escapeHtml(description), money(line.amountSgd), 'line', i === 0))
    for (const discount of line.discounts) {
      rows.push(row(escapeHtml(discount.label), `${money(discount.amountSgd)} off`, 'detail'))
    }
  })
  rows.push(row('Total paid', money(receipt.totalSgd), 'total'))

  const paid =
    receipt.payments.length === 0
      ? 'No payment: nothing was due.'
      : receipt.payments
          .map(p => `Paid by ${escapeHtml(paymentLabel(p))} on ${day.format(new Date(p.paidAt))}: ${money(p.amountSgd)}`)
          .join('<br />')
  const note = (html: string, color: string = C.muted) =>
    `<p style="margin:0 0 10px;font-family:${FONT};font-size:13px;line-height:1.55;color:${color};">${html}</p>`

  return `<div data-receipt-block style="margin:24px 0 0;">
<h2 style="margin:0 0 6px;font-family:${FONT};font-size:17px;line-height:1.3;font-weight:700;color:${C.ink};">Receipt ${escapeHtml(receipt.displayNumber)}</h2>
${note(`Issued ${day.format(receipt.issuedAt)}`)}${receipt.refundedAt ? note(`<strong>Refunded on ${day.format(receipt.refundedAt)}</strong>`, '#b42318') : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 14px;border:1px solid ${C.border};border-radius:8px;background:${C.panel};border-collapse:separate;">
${rows.join('\n')}
</table>
${note(paid)}
${note(`The receipt is attached as ${escapeHtml(receiptPdfFilename(receipt))}.`)}
</div>`
}

/** What an email needs to carry one Receipt. */
export interface ReceiptMail {
  /** `receipt_url` (the member's Receipt in the booking app) and `receipt_number`. */
  variables: { receipt_url: string; receipt_number: string }
  /** The itemised block, for the frame to draw under the studio's copy. Trusted HTML. */
  blockHtml: string
  /** The Receipt's PDF. */
  attachments: MailAttachment[]
}

export async function receiptMail(receipt: ReceiptRow): Promise<ReceiptMail> {
  return {
    variables: {
      receipt_url: await receiptPageUrl(receipt.tenantId, receipt.id),
      receipt_number: receipt.displayNumber,
    },
    blockHtml: receiptEmailBlock(receipt),
    attachments: [await receiptAttachment(receipt)],
  }
}

/**
 * A templated send with the Receipt added: `receipt_url` and `receipt_number`
 * filled (over anything the caller put there), the block under the studio's
 * copy, and the PDF attached. A send with no Receipt to carry (`null`: a grant
 * no Receipt was issued for) goes as it was given.
 *
 * `sendTemplatedEmail(await withReceipt({ tenantId, slug, recipient, variables }, receipt))`
 */
export async function withReceipt(input: SendInput, receipt: ReceiptRow | null): Promise<SendInput> {
  if (!receipt) return input
  const mail = await receiptMail(receipt)
  return {
    ...input,
    variables: { ...input.variables, ...mail.variables },
    appendixHtml: [input.appendixHtml, mail.blockHtml].filter(Boolean).join('\n'),
    attachments: [...(input.attachments ?? []), ...mail.attachments],
  }
}
