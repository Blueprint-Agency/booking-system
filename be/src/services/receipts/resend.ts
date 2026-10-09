/**
 * An admin sends a member their Receipt again (#390): a member who lost the
 * email asks the studio for it.
 *
 * It goes in the very email the purchase sent (`purchaseEmail`), with the
 * receipt block and the PDF, to the address the member has **now**: the
 * Receipt's own buyer email is what it was issued to, and a member who has
 * moved address asks precisely because the old one no longer reaches them.
 * Nothing else is ever a recipient (spec #380, out of scope).
 *
 * Each resend files one `receipt_resent` audit row naming the admin. The row
 * is about the member's record (`target_table = 'clients'`), so a permanent
 * deletion erases the address it was sent to with the rest of what names them
 * (`clients/erase-audit-row.ts`).
 */
import { db } from '../../db'
import { auditLog } from '../../db/schema/ledger'
import { ConflictError } from '../../shared/errors'
import { purchaseEmail } from '../notifications/send-purchase-email'
import { sendTemplatedEmail } from '../notifications/send'
import { studioReceipt } from './read'

export interface ResendReceiptInput {
  tenantId: string
  receiptId: string
  actorStaffId: string
}

/**
 * Send the Receipt again and record who did. `404 receipt_not_found` for a
 * Receipt not at this studio; `409 receipt_member_deleted` once its member has
 * been permanently deleted, with nothing sent.
 */
export async function resendReceipt(input: ResendReceiptInput): Promise<{ sentTo: string }> {
  const receipt = await studioReceipt(input.tenantId, input.receiptId)
  if (!receipt.clientId) throw new ConflictError('receipt_member_deleted')

  const email = await purchaseEmail(input.tenantId, receipt)
  await sendTemplatedEmail(email)

  await db.insert(auditLog).values({
    tenantId: input.tenantId,
    actorStaffId: input.actorStaffId,
    actorType: 'staff',
    action: 'receipt_resent',
    targetTable: 'clients',
    targetId: receipt.clientId,
    payload: { receipt_id: receipt.id, receipt_number: receipt.displayNumber, sent_to: email.recipient.email },
  })
  return { sentTo: email.recipient.email }
}
