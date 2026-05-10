import { renderTemplate } from './render'
import { mailer, MAIL_FROM } from '../../lib/mailer'
import { db } from '../../db'
import { emailTemplates, emailLog } from '../../db/schema/content'
import { eq } from 'drizzle-orm'

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
  | 'rating_prompt_class'
  | 'rating_prompt_workshop'
  | 'package_purchase_confirmed'
  | 'credit_expiry_reminder'
  | 'instructor_invite'
  | 'admin_invite'
  | 'checkin_nag'
  | 'referral_credited'

export interface SendInput {
  slug: TemplateSlug
  recipient: { email: string; userId?: string; userKind: 'client' | 'staff' }
  variables: Record<string, string>
}

export async function enqueueEmail({ slug, recipient, variables }: SendInput): Promise<void> {
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
    const info = await mailer.sendMail({
      from: MAIL_FROM,
      to: recipient.email,
      subject,
      html: body,
    })
    await db
      .update(emailLog)
      .set({
        status: 'sent',
        smtpMessageId: info.messageId,
        smtpResponse: typeof info.response === 'string' ? info.response.split('\n').pop() : null,
        sentAt: new Date(),
      })
      .where(eq(emailLog.id, logRow.id))
  } catch (err) {
    await db
      .update(emailLog)
      .set({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
      .where(eq(emailLog.id, logRow.id))
    throw err
  }
}
