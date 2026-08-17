/**
 * The copy every transactional email is made of, and the one shell they share.
 *
 * Pure on purpose, and separate from `./email-templates.ts` for the same reason
 * `services/notifications/purchase-email.ts` is separate from its `send-`
 * sibling: the seeder needs the studio's real origins out of `../../env`, which
 * zod-parses the WHOLE backend env at import — right for a booting server, and
 * wrong for a copy file whose check has no database, Clerk key or SMTP password
 * in sight. The origins arrive as an argument instead.
 *
 * Two rules bind everything below:
 *
 *  1. Every `{{var}}` used here must appear in that slug's entry in
 *     `services/notifications/variables.ts`. The renderer substitutes an
 *     unknown variable with an empty string rather than complaining, so drift
 *     shows up as a blank sentence in a member's inbox and nowhere else.
 *  2. **No sentence may promise behaviour the system does not have.** A
 *     template is copy, not a specification: it cannot make a refund happen, or
 *     an email send, by describing one. Where the outcome varies, the sentence
 *     is composed in code and arrives as a whole (`reason_line`,
 *     `validity_line`), because the renderer has no conditionals.
 */

export interface EmailTemplateSeed {
  slug: string
  subject: string
  bodyHtml: string
}

/** The two origins every mailed link is built from — see `buildEmailTemplates`. */
export interface EmailOrigins {
  /** The member-facing app, no trailing slash (`env.ts:CLIENT_URL`). */
  clientUrl: string
  /** The staff portal, no trailing slash (`env.PORTAL_ORIGIN`). */
  portalUrl: string
}

/**
 * The one shell every email is built from — the studio's mark, a card, a
 * heading, prose, an optional call to action, optional fine print, and the
 * footer. Sharing it is what keeps thirty emails looking like one studio.
 *
 * `lines` are whole sentences (inline HTML allowed); each becomes a paragraph.
 */
const body = (
  heading: string,
  lines: string[],
  opts: { cta?: { href: string; label: string }; note?: string } = {},
) => `<!DOCTYPE html>
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
                <h1 style="margin:0 0 16px;font-size:21px;font-weight:600;letter-spacing:-0.01em;">${heading}</h1>
                ${lines
                  .map(
                    l =>
                      `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#4a4742;">${l}</p>`,
                  )
                  .join('\n                ')}${
                    opts.cta
                      ? `
                <p style="margin:24px 0;">
                  <a href="${opts.cta.href}" style="display:inline-block;background:#c97a4a;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:9px;">${opts.cta.label}</a>
                </p>`
                      : ''
                  }${
                    opts.note
                      ? `
                <p style="margin:0 0 14px;font-size:13px;line-height:1.55;color:#7a7670;">${opts.note}</p>`
                      : ''
                  }
                <hr style="border:0;border-top:1px solid #e9e4dd;margin:24px 0;" />
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9b9590;">
                  Yoga Sadhana — Breadtalk IHQ (Tai Seng) &amp; Outram Park.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

/** An inline text link in the studio's accent, for use inside a `lines` entry. */
const link = (href: string, label: string) =>
  `<a href="${href}" style="color:#c97a4a;font-weight:600;text-decoration:none;">${label} →</a>`

/**
 * A labelled fact block — what a confirmation is actually for. Kept to plain
 * paragraphs (no nested table) so it survives every client Gmail renders like.
 */
const facts = (rows: Array<[string, string]>) =>
  rows
    .map(([k, v]) => `<span style="color:#7a7670;">${k}</span> &nbsp;<strong>${v}</strong>`)
    .join('<br />')

export function buildEmailTemplates(origins: EmailOrigins): EmailTemplateSeed[] {
  const { clientUrl, portalUrl } = origins

  const ACCOUNT_URL = `${clientUrl}/account`
  const CLASSES_URL = `${clientUrl}/classes`
  const WORKSHOPS_URL = `${clientUrl}/workshops`
  const PACKAGES_URL = `${clientUrl}/packages`

  /* ── Access: the three invitations and the password reset ────────────── */

  const ADMIN_INVITE_BODY = body(
    "You're invited to the Yoga Sadhana admin portal",
    [
      'Hi {{name}},',
      'You have been invited to join Yoga Sadhana as an admin. Use the button below to set up your account and sign in.',
    ],
    {
      cta: { href: '{{invite_url}}', label: 'Set up your account' },
      note: "This invitation expires on <strong>{{expires_at}}</strong>. If the button doesn't work, paste this into your browser: {{invite_url}} — and if you weren't expecting this invitation, you can safely ignore this email.",
    },
  )

  const INSTRUCTOR_INVITE_BODY = body(
    "You're invited to teach at Yoga Sadhana",
    [
      'Hi {{name}},',
      "The Yoga Sadhana team has added you as an instructor. Set up your account below to reach the portal, where you'll find your teaching schedule, your class rosters and your leave.",
    ],
    {
      cta: { href: '{{invite_url}}', label: 'Set up your account' },
      note: "This invitation expires on <strong>{{expires_at}}</strong>. If the button doesn't work, paste this into your browser: {{invite_url}} — and if you weren't expecting this invitation, you can safely ignore this email.",
    },
  )

  const CLIENT_INVITE_BODY = body(
    'Welcome to Yoga Sadhana',
    [
      'Hi {{name}},',
      'The Yoga Sadhana team has created an account for you, so you can book classes, workshops and private sessions.',
    ],
    {
      cta: { href: '{{login_url}}', label: 'Sign in to your account' },
      note: 'Your account email is <strong>{{invitee_email}}</strong>. Use "Forgot password" on the sign-in screen to set your password the first time. If the button doesn\'t work, paste this into your browser: {{login_url}}',
    },
  )

  const WELCOME_BODY = body(
    'Welcome to Yoga Sadhana',
    [
      'Hi {{client_name}},',
      'Your account is ready. You can book classes, reserve a workshop place and request private sessions from the app.',
      `A class needs credits or a plan — ${link(PACKAGES_URL, 'see what we offer')}.`,
    ],
    { cta: { href: CLASSES_URL, label: 'Browse the timetable' } },
  )

  const PASSWORD_RESET_BODY = body(
    'Reset your password',
    [
      'Hi {{client_name}},',
      'We received a request to reset your Yoga Sadhana password. Use the button below to choose a new one.',
    ],
    {
      cta: { href: '{{reset_url}}', label: 'Choose a new password' },
      note: "If you didn't ask for this, ignore this email — your password stays as it is. If the button doesn't work, paste this into your browser: {{reset_url}}",
    },
  )

  /* ── Classes ─────────────────────────────────────────────────────────── */

  const CLASS_BOOKING_BODY = body(
    'Your class is booked',
    [
      'Hi {{client_name}},',
      facts([
        ['Class', '{{class_name}}'],
        ['When', '{{date}}'],
        ['With', '{{instructor_name}}'],
        ['Where', '{{location}}'],
      ]),
      'Your check-in code is <strong>{{code}}</strong>. Show it at the studio, or open the QR code below.',
      link('{{qr_url}}', 'Show your QR code'),
    ],
    { note: 'Credits remaining: <strong>{{credits_remaining}}</strong>.' },
  )

  const CLASS_CANCELLED_RETURNED_BODY = body('Your booking is cancelled — credit returned', [
    'Hi {{client_name}},',
    'Your booking for <strong>{{class_name}}</strong> on <strong>{{date}}</strong> has been cancelled.',
    '<strong>{{credits_returned}}</strong> credit(s) are back in your account, ready for another class.',
    link(CLASSES_URL, 'Book another class'),
  ])

  // `reason_line` is a whole composed sentence (policy/evaluate-cancellation.ts:
  // `forfeitLine`) because a forfeit has four causes and only two of them are
  // lateness — an over-cap forfeit happens to a member who cancelled in good
  // time, and telling them they were late is simply false.
  const CLASS_CANCELLED_FORFEITED_BODY = body('Your class booking is cancelled', [
    'Hi {{client_name}},',
    'Your booking for <strong>{{class_name}}</strong> on <strong>{{date}}</strong> has been cancelled.',
    '{{reason_line}}',
    link(CLASSES_URL, 'Book another class'),
  ])

  const ADMIN_CANCEL_CLASS_BODY = body('A class has been cancelled', [
    'Hi {{client_name}},',
    'The studio has cancelled <strong>{{class_name}}</strong> on <strong>{{date}}</strong>. We are sorry for the change of plan.',
    '<strong>{{credits_returned}}</strong> credit(s) have been returned to your account — nothing was charged for the cancelled class.',
    link(CLASSES_URL, 'Find another class'),
  ])

  /* ── Private sessions ────────────────────────────────────────────────── */

  // No promise of a decision email: nothing in `be/src` sends
  // `pt_session_approved` or `pt_session_declined` yet, and copy cannot make a
  // sender exist. It points at the page that does show the outcome.
  const PT_REQUEST_SUBMITTED_BODY = body('Your private session request was received', [
    'Hi {{client_name}},',
    'You asked <strong>{{instructor_name}}</strong> for a private session on <strong>{{starts_at}}</strong>.',
    'Nothing is confirmed and no session has been deducted yet. Your account shows the request and its outcome once the instructor has answered.',
    link(ACCOUNT_URL, 'View your requests'),
  ])

  const PT_SESSION_APPROVED_BODY = body(
    'Your private session is confirmed',
    [
      'Hi {{client_name}},',
      facts([
        ['With', '{{instructor_name}}'],
        ['When', '{{starts_at}}'],
        ['Where', '{{location}}'],
      ]),
      link('{{qr_url}}', 'Show your QR code'),
    ],
    { note: 'Please arrive a few minutes early so you can settle before the session starts.' },
  )

  const PT_SESSION_DECLINED_BODY = body('Your private session request was declined', [
    'Hi {{client_name}},',
    '<strong>{{instructor_name}}</strong> is not able to take your private session request.',
    'Reason given: {{decline_note}}',
    `Your session is untouched — you can request another time or another instructor. ${link(ACCOUNT_URL, 'Request another session')}`,
  ])

  const PT_REQUEST_EXPIRED_BODY = body('Your private session request expired', [
    'Hi {{client_name}},',
    'Your request to <strong>{{instructor_name}}</strong> for <strong>{{starts_at}}</strong> was not answered in time, so it has expired.',
    `Nothing was deducted. ${link(ACCOUNT_URL, 'Request another time')}`,
  ])

  const PT_CANCELLED_RETURNED_BODY = body(
    'Your private session is cancelled — session returned',
    [
      'Hi {{client_name}},',
      'Your private session with <strong>{{instructor_name}}</strong> on <strong>{{starts_at}}</strong> has been cancelled.',
      `The session is back in your account and can be used for another booking. ${link(ACCOUNT_URL, 'Book another session')}`,
    ],
  )

  const PT_CANCELLED_FORFEITED_BODY = body('Your private session is cancelled', [
    'Hi {{client_name}},',
    'Your private session with <strong>{{instructor_name}}</strong> on <strong>{{starts_at}}</strong> has been cancelled.',
    '{{reason_line}}',
    link(ACCOUNT_URL, 'View your account'),
  ])

  const ADMIN_CANCEL_PT_BODY = body('A private session has been cancelled', [
    'Hi {{client_name}},',
    'The studio has cancelled your private session with <strong>{{instructor_name}}</strong> on <strong>{{starts_at}}</strong>. We are sorry for the change of plan.',
    `The session is back in your account. ${link(ACCOUNT_URL, 'Book another time')}`,
  ])

  /* ── Workshops ───────────────────────────────────────────────────────── */

  const WORKSHOP_PURCHASE_BODY = body('Your workshop place is confirmed', [
    'Hi {{client_name}},',
    facts([
      ['Workshop', '{{workshop_name}}'],
      ['Starts', '{{date}}'],
    ]),
    'Your check-in code is <strong>{{code}}</strong>.',
    `${link('{{qr_url}}', 'Show your QR code')}<br /><a href="{{receipt_url}}" style="color:#7a7670;text-decoration:none;">View your purchase</a>`,
  ])

  // Waitlist promotion is deferred (backend-architecture.md §jobs), so this row
  // exists for the template editor. The claim is time-bound and paid — both
  // facts belong in the copy, or the member reads it as a place already theirs.
  const WORKSHOP_WAITLIST_PROMOTED_BODY = body(
    'A place has opened in {{workshop_name}}',
    [
      'Hi {{client_name}},',
      'A place has come free in <strong>{{workshop_name}}</strong>, starting <strong>{{date}}</strong>, and it is offered to you first.',
      'Confirm and pay by <strong>{{claim_deadline}}</strong> to take it. After that the place is offered to the next person on the waitlist.',
    ],
    { cta: { href: '{{claim_url}}', label: 'Confirm and pay' } },
  )

  // Automated refunds do not exist for a cancelled workshop — `services/
  // workshops/cancel.ts` marks affected bookings `refund_outcome='n_a'`. So the
  // copy says what is true: the studio arranges it by hand.
  const ADMIN_CANCEL_WORKSHOP_BODY = body('A workshop has been cancelled', [
    'Hi {{client_name}},',
    'The studio has cancelled <strong>{{workshop_name}}</strong>. We are sorry — we know a workshop is a date people plan around.',
    'You paid <strong>SGD {{refund_sgd}}</strong> for your place. The studio is arranging your refund and will contact you to settle it.',
    link(WORKSHOPS_URL, 'See upcoming workshops'),
  ])

  /* ── Purchases and packages ──────────────────────────────────────────── */

  /**
   * The purchase confirmations (§13). Every variable below is a WHOLE composed
   * sentence built in code — the renderer has no conditionals, so a fragment
   * would be a wrong sentence for some package kind. That is why one template
   * serves a Credit Bundle, an Unlimited Plan and a PT package without ever
   * mentioning Activation to the first two.
   *
   * The anchor text is neutral on purpose: `receipt_url` is the provider's
   * receipt on a paid purchase and the account page on a free one.
   */
  const PACKAGE_PURCHASE_BODY = body('Your package is confirmed', [
    'Hi {{client_name}},',
    facts([['Package', '{{package_name}}']]) + '<br />{{contents_line}}<br />{{validity_line}}',
    link('{{receipt_url}}', 'View your purchase'),
  ])

  /** A first-timer's welcome, which is not the same email as a $150 receipt. */
  const TRIAL_PASS_PURCHASE_BODY = body('Welcome to Yoga Sadhana', [
    'Hi {{client_name}},',
    facts([['Your pass', '{{package_name}}']]) + '<br />{{contents_line}}<br />{{validity_line}}',
    'Book your first class whenever you are ready. Arrive ten minutes early and someone will show you around.',
    link('{{receipt_url}}', 'View your account'),
  ])

  /**
   * The Refund (§14). The provider sends the money receipt; this one says the
   * entitlement has ended and names the classes that were cancelled with it —
   * both whole composed sentences, for the same reason the purchase emails are.
   */
  const PURCHASE_REFUNDED_BODY = body('Your purchase has been refunded', [
    'Hi {{client_name}},',
    '<strong>{{package_name}}</strong>',
    '{{refund_line}}',
    '{{cancelled_line}}',
    link('{{account_url}}', 'View your account'),
  ])

  // `remaining_line` is composed (notifications/purchase-email.ts:
  // `contentsLine`) rather than a bare number, because this one reminder is
  // also a trial pass's reminder, and a trial holds classes — it has never
  // heard of a credit (backend-architecture.md, credit-expiry job).
  const CREDIT_EXPIRY_BODY = body(
    'Your {{package_name}} expires soon',
    [
      'Hi {{client_name}},',
      'A heads-up: <strong>{{package_name}}</strong> expires on <strong>{{expires_at}}</strong>, and you still have <strong>{{remaining_line}}</strong> on it.',
      `There is still time to use them — ${link(CLASSES_URL, 'book a class')}.`,
    ],
    { note: 'Whatever is left does not carry over once it expires.' },
  )

  const REFERRAL_CREDITED_BODY = body('You earned a referral credit', [
    'Hi {{referrer_name}},',
    '<strong>{{referee_name}}</strong> joined Yoga Sadhana on your referral — thank you for bringing them in.',
    `<strong>{{credits_granted}}</strong> credit(s) have been added to your account. ${link(CLASSES_URL, 'Book a class')}`,
  ])

  /* ── Staff-facing ────────────────────────────────────────────────────── */

  /**
   * Sent to every active admin/superadmin when an instructor cancels their own
   * class — the whole point is that it names the class, the instructor and the
   * reason.
   */
  const INSTRUCTOR_CANCEL_CLASS_BODY = body(
    'A class was cancelled by its instructor',
    [
      '<strong>{{instructor_name}}</strong> cancelled <strong>{{class_name}}</strong> on <strong>{{date}}</strong>.',
      'Reason given: {{reason}}',
      '<strong>{{refunded_count}}</strong> member(s) were refunded automatically, and the class no longer appears on the timetable.',
    ],
    { cta: { href: `${portalUrl}/admin/schedule`, label: 'Open the schedule' } },
  )

  const CHECKIN_NAG_BODY = body(
    'Check-in is still open for {{session_label}}',
    [
      'Hi {{instructor_name}},',
      '<strong>{{pending_count}}</strong> member(s) on <strong>{{session_label}}</strong> are still unmarked. Attendance drives credits and payroll, so it needs to be right.',
      'It takes a moment in the portal — mark who came and who did not.',
    ],
    { cta: { href: `${portalUrl}/instructor/classes`, label: 'Complete check-in' } },
  )

  /** `{{cap_warning}}` is the §17 sentence: this request puts the studio over a
   *  Leave Cap, and medical is never refused by one, so this is the admins' only
   *  warning in time to arrange cover. It sits at the END of a line rather than on
   *  one of its own: it is empty on almost every submission, and a paragraph of
   *  its own would then render as a blank gap in every ordinary email. */
  const LEAVE_SUBMITTED_BODY = body(
    'A leave request needs a decision',
    [
      '<strong>{{instructor_name}}</strong> requested <strong>{{days}} day(s)</strong> of {{leave_type}} leave on <strong>{{dates}}</strong>. <strong>{{cap_warning}}</strong>',
      'Reason given: {{reason}}',
    ],
    { cta: { href: `${portalUrl}/admin/leave`, label: 'Approve or reject' } },
  )

  const LEAVE_APPROVED_BODY = body('Your leave is approved', [
    'Hi {{instructor_name}}, your {{leave_type}} leave on <strong>{{dates}}</strong> ({{days}} day(s)) has been approved.',
    'You will not be scheduled for classes on those dates.',
  ])

  const LEAVE_REJECTED_BODY = body('Your leave request was rejected', [
    'Hi {{instructor_name}}, your {{leave_type}} leave request for <strong>{{dates}}</strong> ({{days}} day(s)) was not approved.',
    'Reason: {{reason}}',
    'Those days are back in your balance if you want to request different dates.',
  ])

  /** The one that reverses an earlier email, so it says plainly that the leave no
   *  longer stands, who took it back and when. */
  const LEAVE_REVOKED_BODY = body('Your approved leave has been revoked', [
    'Hi {{instructor_name}}, your {{leave_type}} leave on <strong>{{dates}}</strong> ({{days}} day(s)) no longer stands.',
    'It was revoked by <strong>{{revoked_by}}</strong> on {{revoked_at}}. Please treat those dates as normal working days — you may be scheduled for classes on them again.',
    'Those days are back in your balance. Speak to {{revoked_by}} if this is not what you expected.',
  ])

  return [
    { slug: 'welcome', subject: 'Welcome to Yoga Sadhana', bodyHtml: WELCOME_BODY },
    {
      slug: 'client_invite',
      subject: 'Your Yoga Sadhana account is ready',
      bodyHtml: CLIENT_INVITE_BODY,
    },
    { slug: 'password_reset', subject: 'Reset your password', bodyHtml: PASSWORD_RESET_BODY },
    {
      slug: 'class_booking_confirmed',
      subject: '{{class_name}} on {{date}} is booked',
      bodyHtml: CLASS_BOOKING_BODY,
    },
    {
      slug: 'pt_request_submitted',
      subject: 'Your private session request was received',
      bodyHtml: PT_REQUEST_SUBMITTED_BODY,
    },
    {
      slug: 'pt_session_approved',
      subject: 'Your private session on {{starts_at}} is confirmed',
      bodyHtml: PT_SESSION_APPROVED_BODY,
    },
    {
      slug: 'pt_session_declined',
      subject: 'Your private session request was declined',
      bodyHtml: PT_SESSION_DECLINED_BODY,
    },
    {
      slug: 'pt_request_expired',
      subject: 'Your private session request expired',
      bodyHtml: PT_REQUEST_EXPIRED_BODY,
    },
    {
      slug: 'workshop_purchase_confirmed',
      subject: 'Your place at {{workshop_name}} is confirmed',
      bodyHtml: WORKSHOP_PURCHASE_BODY,
    },
    {
      slug: 'workshop_waitlist_promoted',
      subject: "You're off the waitlist — {{workshop_name}}",
      bodyHtml: WORKSHOP_WAITLIST_PROMOTED_BODY,
    },
    {
      slug: 'class_cancelled_credit_returned',
      subject: 'Your class was cancelled — credit returned',
      bodyHtml: CLASS_CANCELLED_RETURNED_BODY,
    },
    {
      slug: 'class_cancelled_forfeited',
      subject: 'Your class booking was cancelled',
      bodyHtml: CLASS_CANCELLED_FORFEITED_BODY,
    },
    {
      slug: 'pt_cancelled_session_returned',
      subject: 'Your private session was cancelled — session returned',
      bodyHtml: PT_CANCELLED_RETURNED_BODY,
    },
    {
      slug: 'pt_cancelled_forfeited',
      subject: 'Your private session was cancelled',
      bodyHtml: PT_CANCELLED_FORFEITED_BODY,
    },
    {
      slug: 'admin_cancel_class',
      subject: '{{class_name}} on {{date}} was cancelled',
      bodyHtml: ADMIN_CANCEL_CLASS_BODY,
    },
    {
      slug: 'admin_cancel_pt',
      subject: 'Your private session on {{starts_at}} was cancelled',
      bodyHtml: ADMIN_CANCEL_PT_BODY,
    },
    {
      slug: 'admin_cancel_workshop',
      subject: '{{workshop_name}} was cancelled',
      bodyHtml: ADMIN_CANCEL_WORKSHOP_BODY,
    },
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
    {
      slug: 'package_purchase_confirmed',
      subject: 'Your package is confirmed',
      bodyHtml: PACKAGE_PURCHASE_BODY,
    },
    {
      slug: 'purchase_refunded',
      subject: 'Your purchase has been refunded',
      bodyHtml: PURCHASE_REFUNDED_BODY,
    },
    {
      slug: 'credit_expiry_reminder',
      subject: 'Your {{package_name}} expires on {{expires_at}}',
      bodyHtml: CREDIT_EXPIRY_BODY,
    },
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
    {
      slug: 'checkin_nag',
      subject: 'Check-in is still open for {{session_label}}',
      bodyHtml: CHECKIN_NAG_BODY,
    },
    {
      slug: 'referral_credited',
      subject: 'You earned a referral credit',
      bodyHtml: REFERRAL_CREDITED_BODY,
    },
    {
      slug: 'trial_pass_purchase_confirmed',
      subject: 'Welcome to Yoga Sadhana',
      bodyHtml: TRIAL_PASS_PURCHASE_BODY,
    },
  ]
}
