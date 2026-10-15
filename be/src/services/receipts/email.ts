/**
 * A Receipt in an email (#380, #387): the Receipt under the studio's copy, the
 * PDF attached, and the two template variables that name it.
 *
 * **The one way any email carries a Receipt.** The four purchase confirmations
 * call `withReceipt`, and so do the `purchase_receipt` email for Merch and a
 * standalone Cross-Location Add-On (#388) and an admin's resend (#390), so a
 * Receipt reads the same in every inbox.
 *
 * The block is the Receipt as `html.ts` draws it, the same markup the member's
 * and the admin's Receipt pages show. It is markup the backend builds, so it
 * cannot be a template variable: the renderer HTML-escapes every value it
 * substitutes. It goes in the frame instead (`SendInput.appendixHtml`), under
 * the studio's own body, which stays the studio's to word and needs no editing
 * for the block to appear.
 */
import type { MailAttachment } from '../../lib/mailer'
import { EMAIL_COLORS, EMAIL_FONT as FONT, escapeHtml } from '../mail/layout'
import type { SendInput } from '../notifications/send'
import { requireTenantUrl } from '../tenants/urls'
import { receiptDocument, receiptStudio, type ReceiptStudio } from './document'
import { receiptHtml } from './html'
import type { ReceiptRow } from './issue'
import { receiptPdf, receiptPdfFilename } from './pdf'

/** The member's Receipt in their own studio's booking app. */
export async function receiptPageUrl(tenantId: string, receiptId: string): Promise<string> {
  return `${await requireTenantUrl('client', tenantId)}/account/receipts/${receiptId}`
}

/** The Receipt as a file to attach: its PDF, named after its number (`R-000123.pdf`). */
export async function receiptAttachment(receipt: ReceiptRow, studio?: ReceiptStudio): Promise<MailAttachment> {
  return { filename: receiptPdfFilename(receipt), contentType: 'application/pdf', content: await receiptPdf(receipt, studio) }
}

/**
 * The Receipt as an email body fragment: the Receipt itself, as every screen
 * shows it, and a line naming the PDF attached to the email.
 */
export async function receiptEmailBlock(receipt: ReceiptRow, studio?: ReceiptStudio): Promise<string> {
  const document = receiptDocument(receipt, studio ?? (await receiptStudio(receipt)))
  return `<div style="margin:24px 0 0;">
${receiptHtml(document)}
<p style="margin:12px 0 0;font-family:${FONT};font-size:13px;line-height:1.55;color:${EMAIL_COLORS.muted};">The receipt is attached as ${escapeHtml(receiptPdfFilename(receipt))}.</p>
</div>`
}

/** What an email needs to carry one Receipt. */
export interface ReceiptMail {
  /** `receipt_url` (the member's Receipt in the booking app) and `receipt_number`. */
  variables: { receipt_url: string; receipt_number: string }
  /** The Receipt, for the frame to draw under the studio's copy. Trusted HTML. */
  blockHtml: string
  /** The Receipt's PDF. */
  attachments: MailAttachment[]
}

export async function receiptMail(receipt: ReceiptRow): Promise<ReceiptMail> {
  // The studio is read once, for the block and the PDF alike.
  const studio = await receiptStudio(receipt)
  const [receiptUrl, blockHtml, attachment] = await Promise.all([
    receiptPageUrl(receipt.tenantId, receipt.id),
    receiptEmailBlock(receipt, studio),
    receiptAttachment(receipt, studio),
  ])
  return {
    variables: { receipt_url: receiptUrl, receipt_number: receipt.displayNumber },
    blockHtml,
    attachments: [attachment],
  }
}

/**
 * A templated send with the Receipt added: `receipt_url` and `receipt_number`
 * filled (over anything the caller put there), the Receipt under the studio's
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
