import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from '../schema'

/**
 * All 25 email template slugs per spec §4j. Most subjects/bodies are placeholders
 * — the real copy lands in later slices. UPSERT on slug so re-running the seed
 * picks up edits without overwriting admin-edited templates in production data
 * (admin edits run via PATCH /portal/admin/notifications/templates/:slug, which
 * is a separate path; the seed is only used in dev/CI/staging).
 *
 * `admin_invite` is the first template with real copy (this slice — staff invite
 * flow). Subject + body land in production via the UPSERT below.
 */

const PLACEHOLDER_BODY = '<p>{{client_name}}</p>'

/**
 * Branded HTML for the staff invitation email. References:
 *   - `{{name}}` — invitee name (falls back to email local-part at send time)
 *   - `{{invite_url}}` — sign-up URL ({{sign_up_url}} is the same value)
 *   - `{{expires_at}}` — human-readable expiry timestamp (SGT)
 *   - `{{inviter_name}}` — display name of the inviting superadmin
 */
const ADMIN_INVITE_BODY = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f7f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f1d1b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f2;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e9e4dd;border-radius:14px;padding:32px 36px;">
            <tr>
              <td style="padding-bottom:20px;">
                <div style="display:inline-block;vertical-align:middle;width:36px;height:36px;background:#c97a4a;border-radius:8px;color:#ffffff;font-weight:700;font-size:14px;line-height:36px;text-align:center;">YS</div>
                <span style="display:inline-block;vertical-align:middle;margin-left:10px;font-size:15px;font-weight:600;letter-spacing:-0.01em;">Yoga Sadhana</span>
              </td>
            </tr>
            <tr>
              <td>
                <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;letter-spacing:-0.01em;">You're invited to the Yoga Sadhana admin portal</h1>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#4a4742;">Hi {{name}},</p>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#4a4742;">
                  {{inviter_name}} has invited you to join Yoga Sadhana as an admin.
                  Click the button below to set up your account and sign in.
                </p>
                <p style="margin:24px 0;">
                  <a href="{{invite_url}}" style="display:inline-block;background:#c97a4a;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:9px;">
                    Set up your account
                  </a>
                </p>
                <p style="margin:0 0 14px;font-size:13px;line-height:1.55;color:#7a7670;">
                  This invitation expires on <strong>{{expires_at}}</strong>. If the link doesn't work, paste this URL into your browser:
                </p>
                <p style="margin:0 0 24px;font-size:12px;line-height:1.55;color:#7a7670;word-break:break-all;">
                  {{invite_url}}
                </p>
                <hr style="border:0;border-top:1px solid #e9e4dd;margin:24px 0;" />
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9b9590;">
                  If you weren't expecting this invitation, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

/**
 * Branded HTML for the instructor invitation email. References:
 *   - `{{name}}` — instructor name (provided at create time)
 *   - `{{invite_url}}` — portal sign-up URL ({{sign_up_url}} is the same value)
 *   - `{{invitee_email}}` — the account email
 */
const INSTRUCTOR_INVITE_BODY = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f7f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f1d1b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f2;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e9e4dd;border-radius:14px;padding:32px 36px;">
            <tr>
              <td style="padding-bottom:20px;">
                <div style="display:inline-block;vertical-align:middle;width:36px;height:36px;background:#c97a4a;border-radius:8px;color:#ffffff;font-weight:700;font-size:14px;line-height:36px;text-align:center;">YS</div>
                <span style="display:inline-block;vertical-align:middle;margin-left:10px;font-size:15px;font-weight:600;letter-spacing:-0.01em;">Yoga Sadhana</span>
              </td>
            </tr>
            <tr>
              <td>
                <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;letter-spacing:-0.01em;">You're invited to teach at Yoga Sadhana</h1>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#4a4742;">Hi {{name}},</p>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#4a4742;">
                  The Yoga Sadhana team has added you as an instructor. Click the button
                  below to set up your account and access the portal, where you'll see your
                  teaching schedule and class rosters.
                </p>
                <p style="margin:24px 0;">
                  <a href="{{invite_url}}" style="display:inline-block;background:#c97a4a;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:9px;">
                    Set up your account
                  </a>
                </p>
                <p style="margin:0 0 14px;font-size:13px;line-height:1.55;color:#7a7670;">
                  Your account email is <strong>{{invitee_email}}</strong>. If the button doesn't work, paste this URL into your browser:
                </p>
                <p style="margin:0 0 24px;font-size:12px;line-height:1.55;color:#7a7670;word-break:break-all;">
                  {{invite_url}}
                </p>
                <hr style="border:0;border-top:1px solid #e9e4dd;margin:24px 0;" />
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9b9590;">
                  If you weren't expecting this invitation, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

const CLIENT_INVITE_BODY = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f7f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f1d1b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f2;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e9e4dd;border-radius:14px;padding:32px 36px;">
            <tr>
              <td style="padding-bottom:20px;">
                <div style="display:inline-block;vertical-align:middle;width:36px;height:36px;background:#c97a4a;border-radius:8px;color:#ffffff;font-weight:700;font-size:14px;line-height:36px;text-align:center;">YS</div>
                <span style="display:inline-block;vertical-align:middle;margin-left:10px;font-size:15px;font-weight:600;letter-spacing:-0.01em;">Yoga Sadhana</span>
              </td>
            </tr>
            <tr>
              <td>
                <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;letter-spacing:-0.01em;">Welcome to Yoga Sadhana</h1>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#4a4742;">Hi {{name}},</p>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#4a4742;">
                  The Yoga Sadhana team has created an account for you so you can book classes,
                  workshops, and private sessions. Click below to sign in — use the
                  "Forgot password" option on the sign-in screen to set your password the first time.
                </p>
                <p style="margin:24px 0;">
                  <a href="{{login_url}}" style="display:inline-block;background:#c97a4a;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:9px;">
                    Sign in to your account
                  </a>
                </p>
                <p style="margin:0 0 14px;font-size:13px;line-height:1.55;color:#7a7670;">
                  Your account email is <strong>{{invitee_email}}</strong>. If the button doesn't work, paste this URL into your browser:
                </p>
                <p style="margin:0 0 24px;font-size:12px;line-height:1.55;color:#7a7670;word-break:break-all;">
                  {{login_url}}
                </p>
                <hr style="border:0;border-top:1px solid #e9e4dd;margin:24px 0;" />
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9b9590;">
                  If you weren't expecting this, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

/**
 * Sent to every active admin/superadmin when an instructor cancels their own
 * class. Needs real copy (not the placeholder) because the whole point is that
 * it names the class, the instructor and the reason.
 */
const INSTRUCTOR_CANCEL_CLASS_BODY = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f7f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f1d1b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f2;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e9e4dd;border-radius:14px;padding:32px 36px;">
            <tr>
              <td>
                <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;letter-spacing:-0.01em;">A class was cancelled by its instructor</h1>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#4a4742;">
                  <strong>{{instructor_name}}</strong> cancelled <strong>{{class_name}}</strong> on <strong>{{date}}</strong>.
                </p>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#4a4742;">
                  Reason given: {{reason}}
                </p>
                <p style="margin:0 0 14px;font-size:13px;line-height:1.55;color:#7a7670;">
                  {{refunded_count}} member(s) were refunded automatically. The class no longer appears on the timetable.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

/**
 * The four leave emails. They share a shape — a heading and a few lines — so
 * they share a builder rather than three near-identical HTML blobs. The
 * placeholder body is no use here: every one of them exists to carry the dates
 * and (for a rejection) the reason.
 */
const leaveBody = (heading: string, lines: string[]) => `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f7f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f1d1b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f2;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e9e4dd;border-radius:14px;padding:32px 36px;">
            <tr>
              <td>
                <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;letter-spacing:-0.01em;">${heading}</h1>
                ${lines
                  .map(
                    l =>
                      `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#4a4742;">${l}</p>`,
                  )
                  .join('\n                ')}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

const LEAVE_SUBMITTED_BODY = leaveBody('A leave request needs a decision', [
  '<strong>{{instructor_name}}</strong> requested <strong>{{days}} day(s)</strong> of {{leave_type}} leave on <strong>{{dates}}</strong>.',
  'Reason given: {{reason}}',
  'Approve or reject it on the Leave page in the portal.',
])

const LEAVE_APPROVED_BODY = leaveBody('Your leave is approved', [
  'Hi {{instructor_name}}, your {{leave_type}} leave on <strong>{{dates}}</strong> ({{days}} day(s)) has been approved.',
  'You will not be scheduled for classes on those dates.',
])

const LEAVE_REJECTED_BODY = leaveBody('Your leave request was rejected', [
  'Hi {{instructor_name}}, your {{leave_type}} leave request for <strong>{{dates}}</strong> ({{days}} day(s)) was not approved.',
  'Reason: {{reason}}',
  'Those days are back in your balance if you want to request different dates.',
])

/** The one that reverses an earlier email, so it says plainly that the leave no
 *  longer stands, who took it back and when. */
const LEAVE_REVOKED_BODY = leaveBody('Your approved leave has been revoked', [
  'Hi {{instructor_name}}, your {{leave_type}} leave on <strong>{{dates}}</strong> ({{days}} day(s)) no longer stands.',
  'It was revoked by <strong>{{revoked_by}}</strong> on {{revoked_at}}. Please treat those dates as normal working days — you may be scheduled for classes on them again.',
  'Those days are back in your balance. Speak to {{revoked_by}} if this is not what you expected.',
])

const TEMPLATES: Array<{ slug: string; subject: string; bodyHtml?: string }> = [
  { slug: 'welcome',                            subject: 'Welcome to Yoga Sadhana' },
  {
    slug: 'client_invite',
    subject: 'Your Yoga Sadhana account is ready',
    bodyHtml: CLIENT_INVITE_BODY,
  },
  { slug: 'password_reset',                     subject: 'Reset your password' },
  { slug: 'class_booking_confirmed',            subject: 'Your class booking is confirmed' },
  { slug: 'pt_request_submitted',               subject: 'Your private session request was received' },
  { slug: 'pt_session_approved',                subject: 'Your private session is scheduled' },
  { slug: 'pt_session_declined',                subject: 'Your private session request was declined' },
  { slug: 'pt_request_expired',                 subject: 'Your private session request expired' },
  { slug: 'workshop_purchase_confirmed',        subject: 'Your workshop purchase is confirmed' },
  { slug: 'workshop_waitlist_promoted',         subject: "You're off the waitlist" },
  { slug: 'class_cancelled_credit_returned',    subject: 'Your class was cancelled — credit returned' },
  { slug: 'class_cancelled_forfeited',          subject: 'Your class booking was cancelled' },
  { slug: 'pt_cancelled_session_returned',      subject: 'Your private session was cancelled — session returned' },
  { slug: 'pt_cancelled_forfeited',             subject: 'Your private session was cancelled' },
  { slug: 'admin_cancel_class',                 subject: 'A class was cancelled by the studio' },
  { slug: 'admin_cancel_pt',                    subject: 'A private session was cancelled by the studio' },
  { slug: 'admin_cancel_workshop',              subject: 'A workshop was cancelled by the studio' },
  {
    slug: 'instructor_cancel_class',
    subject: '{{instructor_name}} cancelled {{class_name}}',
    bodyHtml: INSTRUCTOR_CANCEL_CLASS_BODY,
  },
  {
    slug: 'leave_request_submitted',
    subject: '{{instructor_name}} requested {{leave_type}} leave — {{dates}}',
    bodyHtml: LEAVE_SUBMITTED_BODY,
  },
  {
    slug: 'leave_approved',
    subject: 'Your leave on {{dates}} is approved',
    bodyHtml: LEAVE_APPROVED_BODY,
  },
  {
    slug: 'leave_rejected',
    subject: 'Your leave request for {{dates}} was rejected',
    bodyHtml: LEAVE_REJECTED_BODY,
  },
  {
    slug: 'leave_revoked',
    subject: 'Your approved leave on {{dates}} was revoked',
    bodyHtml: LEAVE_REVOKED_BODY,
  },
  { slug: 'package_purchase_confirmed',         subject: 'Your package purchase is confirmed' },
  { slug: 'credit_expiry_reminder',             subject: 'Your credits are expiring soon' },
  {
    slug: 'instructor_invite',
    subject: "You've been invited as an instructor",
    bodyHtml: INSTRUCTOR_INVITE_BODY,
  },
  {
    slug: 'admin_invite',
    subject: "You've been invited to Yoga Sadhana — Admin Portal",
    bodyHtml: ADMIN_INVITE_BODY,
  },
  { slug: 'checkin_nag',                        subject: 'Please complete check-in for your session' },
  { slug: 'referral_credited',                  subject: 'You earned a referral credit' },
  { slug: 'trial_pass_purchase_confirmed',      subject: 'Your trial pass is ready' },
]

export async function seedEmailTemplates(db: PostgresJsDatabase<typeof schema>) {
  for (const t of TEMPLATES) {
    const body = t.bodyHtml ?? PLACEHOLDER_BODY
    await db.execute(sql`
      INSERT INTO email_templates (slug, subject, body_html)
      VALUES (${t.slug}, ${t.subject}, ${body})
      ON CONFLICT (slug) DO UPDATE
        SET subject = EXCLUDED.subject,
            body_html = EXCLUDED.body_html,
            updated_at = now()
    `)
  }
}
