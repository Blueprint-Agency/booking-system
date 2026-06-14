import { renderTemplate } from './render'
import { sendMail } from '../../lib/mailer'
import { db } from '../../db'
import { emailTemplates, emailLog } from '../../db/schema/content'
import { eq } from 'drizzle-orm'
import { logger } from '../../shared/logger'

export type TemplateSlug =
  | 'welcome'
  | 'password_reset'
  | 'class_booking_confirmed'
  | 'pt_request_submitted'
  | 'pt_session_approved'
  | 'pt_session_declined'
  | 'workshop_purchase_confirmed'
  | 'class_cancelled_credit_returned'
  | 'class_cancelled_forfeited'
  | 'pt_cancelled_session_returned'
  | 'pt_cancelled_forfeited'
  | 'admin_cancel_class'
  | 'admin_cancel_pt'
  | 'admin_cancel_workshop'
  | 'package_purchase_confirmed'
  | 'credit_expiry_reminder'
  | 'instructor_invite'
  | 'admin_invite'
  | 'client_invite'
  | 'checkin_nag'
  | 'referral_credited'

export interface TemplateRecipient {
  email: string
  /** staff_users.id or clients.id — nullable when we don't yet have a row. */
  userId?: string | null
  userKind: 'client' | 'staff'
}

export interface SendInput {
  slug: TemplateSlug
  recipient: TemplateRecipient
  variables: Record<string, string>
}

/**
 * Look up a template by slug, render `{{var}}` substitutions, send via SMTP,
 * write one `email_log` row. SMTP failures LOG (status='failed') but do not
 * throw — emails are best-effort in v1; we don't want to roll back business
 * actions (e.g. an invitation) because of a transient SMTP hiccup.
 *
 * Throws only when the template row is missing (programming error).
 */
export async function sendTemplatedEmail(input: SendInput): Promise<void> {
  const { slug, recipient, variables } = input
  const [tpl] = await db.select().from(emailTemplates).where(eq(emailTemplates.slug, slug)).limit(1)
  if (!tpl) throw new Error(`unknown_template:${slug}`)

  const subject = renderTemplate(tpl.subject, variables)
  const body = renderTemplate(tpl.bodyHtml, variables)

  const [logRow] = await db
    .insert(emailLog)
    .values({
      templateSlug: slug,
      recipientEmail: recipient.email,
      recipientUserId: recipient.userId ?? null,
      recipientUserKind: recipient.userKind,
      subjectRendered: subject,
      bodyRendered: body,
      status: 'queued',
    })
    .returning()
  if (!logRow) throw new Error('email_log_insert_failed')

  try {
    const result = await sendMail({ to: recipient.email, subject, html: body })
    await db
      .update(emailLog)
      .set({
        status: 'sent',
        smtpMessageId: result.messageId,
        smtpResponse: result.response,
        sentAt: new Date(),
      })
      .where(eq(emailLog.id, logRow.id))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ template: slug, to: recipient.email, err: msg }, 'email send failed')
    await db
      .update(emailLog)
      .set({ status: 'failed', error: msg })
      .where(eq(emailLog.id, logRow.id))
    // Swallow — v1 emails are best-effort; failures show in email_log.
  }
}

/** Back-compat shim. Older callers (none in v0 yet) used the throwing variant. */
export async function enqueueEmail(input: SendInput): Promise<void> {
  await sendTemplatedEmail(input)
}
