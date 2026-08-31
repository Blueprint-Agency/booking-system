import { renderTemplate } from './render'
import { sendMail } from '../../lib/mailer'
import { db } from '../../db'
import { emailTemplates, emailLog } from '../../db/schema/content'
import { staffUsers } from '../../db/schema/identity'
import { and, eq, inArray } from 'drizzle-orm'
import { reportError } from '../../shared/logger'

export type TemplateSlug =
  | 'welcome'
  | 'password_reset'
  | 'class_booking_confirmed'
  | 'pt_request_submitted'
  | 'pt_session_approved'
  | 'pt_session_declined'
  | 'pt_request_expired'
  | 'workshop_purchase_confirmed'
  | 'workshop_waitlist_promoted'
  | 'class_cancelled_credit_returned'
  | 'class_cancelled_forfeited'
  | 'pt_cancelled_session_returned'
  | 'pt_cancelled_forfeited'
  | 'admin_cancel_class'
  | 'admin_cancel_pt'
  | 'admin_cancel_workshop'
  | 'instructor_cancel_class'
  | 'leave_request_submitted'
  | 'leave_approved'
  | 'leave_rejected'
  | 'leave_revoked'
  | 'package_purchase_confirmed'
  // A first-timer's welcome and a $150 receipt are not the same email, and the
  // renderer has no conditionals, so the trial pass needs its own slug (§13).
  | 'trial_pass_purchase_confirmed'
  // §14: the provider sends its own money receipt; this is the one that says the
  // plan has ended and names the classes the Refund cancelled.
  | 'purchase_refunded'
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
  /** Whose words these are — the template is resolved within this tenant, and
   *  the `email_log` row is filed under it. */
  tenantId: string
  slug: TemplateSlug
  recipient: TemplateRecipient
  variables: Record<string, string>
}

/**
 * Look up a template by (tenant, slug), render `{{var}}` substitutions, send via
 * SMTP, write one `email_log` row. SMTP failures LOG (status='failed') but do
 * not throw — emails are best-effort in v1; we don't want to roll back business
 * actions (e.g. an invitation) because of a transient SMTP hiccup.
 *
 * Throws only when the template row is missing (programming error) — which now
 * includes a tenant that has not been seeded its copy, and that is the right
 * failure: sending another studio's wording is worse than sending nothing.
 */
export async function sendTemplatedEmail(input: SendInput): Promise<void> {
  const { tenantId, slug, recipient, variables } = input
  const [tpl] = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.tenantId, tenantId), eq(emailTemplates.slug, slug)))
    .limit(1)
  if (!tpl) throw new Error(`unknown_template:${slug}`)

  const subject = renderTemplate(tpl.subject, variables)
  const body = renderTemplate(tpl.bodyHtml, variables)

  const [logRow] = await db
    .insert(emailLog)
    .values({
      tenantId,
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
      .where(and(eq(emailLog.tenantId, tenantId), eq(emailLog.id, logRow.id)))
  } catch (err) {
    // The error OBJECT, so the stack survives — this is the catch an SMTP fault
    // actually lands in, and callers swallow below it, so it is the last chance
    // anyone has to hear about it. `msg` is for the email_log column only.
    const msg = err instanceof Error ? err.message : String(err)
    reportError(err, 'email send failed', {
      scope: 'email-send',
      template: slug,
      to: recipient.email,
      recipientKind: recipient.userKind,
    })
    await db
      .update(emailLog)
      .set({ status: 'failed', error: msg })
      .where(and(eq(emailLog.tenantId, tenantId), eq(emailLog.id, logRow.id)))
    // Swallow — v1 emails are best-effort; failures show in email_log.
  }
}

/**
 * Email every active admin **of one tenant** — the ONE definition of who "the
 * admins" are.
 *
 * The tenant filter is the load-bearing part: unscoped, a cancelled class at
 * one studio mailed the operational details of that class — member names, the
 * instructor, the room — to every admin on the platform.
 *
 * `variables` is a thunk because building them usually needs a query or two of
 * its own (a class type's name, an instructor's name), and those reads have to
 * sit inside the same swallow as the sends: every caller runs AFTER the row it
 * announces is committed, so nothing here may undo — or fail — that work. A
 * failure is reported (shared/logger.ts) rather than thrown, so a swallowed
 * notification is never a silent one.
 */
export async function emailEveryAdmin(
  tenantId: string,
  slug: TemplateSlug,
  variables: () => Promise<Record<string, string>>,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const vars = await variables()
    const admins = await db
      .select({ id: staffUsers.id, email: staffUsers.email })
      .from(staffUsers)
      .where(
        and(
          eq(staffUsers.tenantId, tenantId),
          inArray(staffUsers.role, ['admin', 'superadmin']),
          eq(staffUsers.status, 'active'),
        ),
      )

    for (const admin of admins) {
      await sendTemplatedEmail({
        tenantId,
        slug,
        recipient: { email: admin.email, userId: admin.id, userKind: 'staff' },
        variables: vars,
      })
    }
  } catch (err) {
    reportError(err, 'admin notification failed', { tenantId, slug, ...context })
  }
}

/** Back-compat shim. Older callers (none in v0 yet) used the throwing variant. */
export async function enqueueEmail(input: SendInput): Promise<void> {
  await sendTemplatedEmail(input)
}
