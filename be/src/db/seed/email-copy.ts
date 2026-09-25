/**
 * The copy every transactional email is made of, and the one shell they share.
 *
 * Pure on purpose, and separate from `./email-templates.ts` for the same reason
 * `services/notifications/purchase-email.ts` is separate from its `send-`
 * sibling: the seeder derives the studio's real origins from `../../env`, which
 * zod-parses the WHOLE backend env at import — right for a booting server, and
 * wrong for a copy file whose check has no database, auth secret or mail key
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

import {
  brandInitials,
  emailButton,
  emailCode,
  emailDetails,
  emailFooterNote,
  emailHeading,
  emailLink,
  emailNote,
  emailParagraph,
  escapeHtml,
} from '../../services/mail/layout'

export interface EmailTemplateSeed {
  slug: string
  subject: string
  bodyHtml: string
}

/**
 * Everything about a studio that its copy has to say out loud.
 *
 * The name is not decoration: it is in the subject line of thirty emails, in
 * the mark at the top of every one of them, and in the sentence that tells a
 * member which studio just charged them. A tenant whose copy said someone
 * else's name would be worse than a tenant with no copy at all, which is why
 * `seedEmailTemplates` passes this per tenant rather than the module holding a
 * default.
 */
export interface EmailStudio {
  /** The studio's own name, as its members know it. */
  name: string
  /**
   * The footer line: where the studio is. Stored with the copy (as an
   * `emailFooterNote`) and lifted into the design's footer at send time.
   * Optional because a brand-new tenant has no premises configured yet, and a
   * footer naming none is better than a footer naming someone else's.
   */
  footer?: string
}

/** The two origins every mailed link is built from — see `buildEmailTemplates`. */
export interface EmailOrigins {
  /** This tenant's member-facing app, no trailing slash — `tenantOrigin('client', slug)`. */
  clientUrl: string
  /** This tenant's staff portal, no trailing slash — `tenantOrigin('portal', slug)`. */
  portalUrl: string
  /** Whose emails these are. */
  studio: EmailStudio
}

/** An initial per word, capped at three — the header mark is a square, not a label. */
export const studioInitials = brandInitials

/**
 * A studio's name goes into HTML that is stored and later mailed, and it is
 * tenant-supplied text. An unescaped `<` in it would be markup in thirty
 * emails, so it is escaped once, here, at the only point it enters the copy.
 */
const esc = escapeHtml

/**
 * The *content* of every email — a heading, prose, an optional call to action
 * and optional fine print — built from the shared design's helpers
 * (`services/mail/layout.ts`). What is stored is this fragment; the header band
 * with the studio's name, the footer and the palette are wrapped around it at
 * send time (`services/notifications/frame.ts`), so they are the same for every
 * template and every studio, and a stored row never goes stale on a redesign.
 *
 * A *factory*, not a constant, because the footer note is the studio's own
 * premises: the design is shared across emails, never across tenants.
 *
 * `lines` are whole sentences (inline HTML allowed); each becomes a paragraph,
 * except a block the helpers already built (detail rows, a code).
 */
const bodyFor =
  (studio: EmailStudio) =>
  (
    heading: string,
    lines: string[],
    opts: { cta?: { href: string; label: string }; note?: string } = {},
  ) =>
    [
      emailHeading(heading),
      ...lines.map(l => (/^<(table|p)[\s>]/.test(l) ? l : emailParagraph(l))),
      opts.cta ? emailButton(opts.cta.href, opts.cta.label) : '',
      opts.note ? emailNote(opts.note) : '',
      // A footer naming nobody beats a footer naming the wrong premises, so a
      // tenant with no address configured carries no note at all.
      studio.footer ? emailFooterNote(studio.footer) : '',
    ]
      .filter(Boolean)
      .join('\n')

/** An inline text link, for use inside a `lines` entry. */
const link = (href: string, label: string) => emailLink(href, `${label} →`)

/** The labelled facts a confirmation is actually for — class, date, place. */
const facts = (rows: Array<[string, string]>) => emailDetails(rows)

export function buildEmailTemplates(origins: EmailOrigins): EmailTemplateSeed[] {
  const { clientUrl, portalUrl, studio } = origins

  // The content builder, bound to this studio's footer. `STUDIO` is the name as
  // it appears in subject lines — plain text, so the raw value; the layout
  // escapes its own copy for the header and footer at send time.
  const body = bodyFor(studio)
  /** For subject lines, which are plain text. */
  const STUDIO = studio.name
  /** For headings and prose, which are interpolated into HTML. */
  const STUDIO_HTML = esc(studio.name)

  const ACCOUNT_URL = `${clientUrl}/account`
  const CLASSES_URL = `${clientUrl}/classes`
  const WORKSHOPS_URL = `${clientUrl}/workshops`
  const PACKAGES_URL = `${clientUrl}/packages`

  /* ── Access: the three invitations and the password reset ────────────── */

  const ADMIN_INVITE_BODY = body(
    `You're invited to the ${STUDIO_HTML} admin portal`,
    [
      'Hi {{name}},',
      `You have been invited to join ${STUDIO_HTML} as an admin. Use the button below to set up your account and sign in.`,
    ],
    {
      cta: { href: '{{invite_url}}', label: 'Set up your account' },
      note: "This invitation expires on <strong>{{expires_at}}</strong>. If the button doesn't work, paste this into your browser: {{invite_url}} — and if you weren't expecting this invitation, you can safely ignore this email.",
    },
  )

  const INSTRUCTOR_INVITE_BODY = body(
    `You're invited to teach at ${STUDIO_HTML}`,
    [
      'Hi {{name}},',
      `The ${STUDIO_HTML} team has added you as an instructor. Set up your account below to reach the portal, where you'll find your teaching schedule, your class rosters and your leave.`,
    ],
    {
      cta: { href: '{{invite_url}}', label: 'Set up your account' },
      note: "This invitation expires on <strong>{{expires_at}}</strong>. If the button doesn't work, paste this into your browser: {{invite_url}} — and if you weren't expecting this invitation, you can safely ignore this email.",
    },
  )

  const CLIENT_INVITE_BODY = body(
    `Welcome to ${STUDIO_HTML}`,
    [
      'Hi {{name}},',
      `The ${STUDIO_HTML} team has created an account for you, so you can book classes, workshops and private sessions.`,
    ],
    {
      cta: { href: '{{login_url}}', label: 'Sign in to your account' },
      note: 'Your account email is <strong>{{invitee_email}}</strong>. Enter it to sign in and we\'ll email you a link to set your password. If the button doesn\'t work, paste this into your browser: {{login_url}}',
    },
  )

  const WELCOME_BODY = body(
    `Welcome to ${STUDIO_HTML}`,
    [
      'Hi {{client_name}},',
      'Your account is ready. You can book classes, reserve a workshop place and request private sessions from the app.',
      `A class needs credits or a plan — ${link(PACKAGES_URL, 'see what we offer')}.`,
    ],
    { cta: { href: CLASSES_URL, label: 'Browse the timetable' } },
  )

  // Sent both to set a first password (an imported or invited member signing in
  // for the first time) and to replace a forgotten one (#173), so it says "set".
  const PASSWORD_RESET_BODY = body(
    'Set your password',
    [
      'Hi {{client_name}},',
      `Use the button below to set your ${STUDIO_HTML} password. You'll be signed in straight away. The link works once, for 30 minutes.`,
    ],
    {
      cta: { href: '{{reset_url}}', label: 'Set your password' },
      note: "If you didn't ask for this, ignore this email — nothing changes. If the button doesn't work, paste this into your browser: {{reset_url}}",
    },
  )

  /* ── Sign-in: the codes and the staff password reset ─────────────────── */

  /** The code itself, set apart so it can be read off a phone at a glance. */
  const code = emailCode('{{code}}')

  /**
   * A member's one-time code (the `client` pool's email OTP). Worded for any
   * reason a code is asked for — signing in and confirming an address are one
   * email to a member — so the plugin's request type needs no branch here.
   */
  const SIGN_IN_CODE_BODY = body(
    'Your one-time code',
    [`Use this code to sign in to your ${STUDIO_HTML} account:`, code],
    {
      note: "The code works once and expires in five minutes. If you didn't ask for it, ignore this email — nobody can sign in with your address without it.",
    },
  )

  /** A staff member's emailed second factor, after their password was accepted. */
  const TWO_FACTOR_CODE_BODY = body(
    'Your verification code',
    [
      'Hi {{name}},',
      `Your password was accepted for the ${STUDIO_HTML} portal. Enter this code to finish signing in:`,
      code,
    ],
    {
      note: "The code works once and expires in five minutes. If you didn't just sign in, someone has your password — change it from the portal's sign-in screen.",
    },
  )

  /**
   * Staff choose their own password: an account created by a seed or an
   * invitation has none, and this is how the first one is set.
   */
  const STAFF_PASSWORD_RESET_BODY = body(
    'Set your portal password',
    [
      'Hi {{name}},',
      `We received a request to set the password for your ${STUDIO_HTML} portal account. Use the button below to choose one.`,
    ],
    {
      cta: { href: '{{reset_url}}', label: 'Choose a password' },
      note: "The link works once and expires in one hour. If you didn't ask for this, ignore this email — your password stays as it is. If the button doesn't work, paste this into your browser: {{reset_url}}",
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

  // Sent when a waitlist promotion books the member in (spec-waitlist.md §11).
  // Promotion only happens outside the Cancellation Window, so `cancel_by` is
  // always still ahead of them.
  const CLASS_WAITLIST_PROMOTED_BODY = body(
    'A seat opened — you’re booked in',
    [
      'Hi {{client_name}},',
      'A seat came free in a class you were waiting for, and you were next in line, so we have booked you in.',
      facts([
        ['Class', '{{class_name}}'],
        ['Date', '{{date}}'],
        ['Time', '{{time}}'],
        ['With', '{{instructor_name}}'],
        ['Where', '{{location_name}}'],
      ]),
      'Your package paid for this class, the same way it does when you book one yourself.',
      'Can’t make it after all? You can cancel free of charge until <strong>{{cancel_by}}</strong>, and whatever it used goes back to your package.',
      link(ACCOUNT_URL, 'See your bookings'),
    ],
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
    `${link('{{qr_url}}', 'Show your QR code')}<br />${emailLink('{{receipt_url}}', 'View your purchase')}`,
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
    facts([
      ['Package', '{{package_name}}'],
      ['Includes', '{{contents_line}}'],
      ['Validity', '{{validity_line}}'],
    ]),
    link('{{receipt_url}}', 'View your purchase'),
  ])

  /** A first-timer's welcome, which is not the same email as a $150 receipt. */
  const TRIAL_PASS_PURCHASE_BODY = body(`Welcome to ${STUDIO_HTML}`, [
    'Hi {{client_name}},',
    facts([
      ['Your pass', '{{package_name}}'],
      ['Includes', '{{contents_line}}'],
      ['Validity', '{{validity_line}}'],
    ]),
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
    facts([['Refunded', '{{package_name}}']]),
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
    `<strong>{{referee_name}}</strong> joined ${STUDIO_HTML} on your referral — thank you for bringing them in.`,
    `<strong>{{credits_granted}}</strong> credit(s) have been added to your account. ${link(CLASSES_URL, 'Book a class')}`,
  ])

  /* ── Staff-facing ────────────────────────────────────────────────────── */

  /**
   * Sent to every active admin when an instructor cancels their own
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

  /** `{{cap_warning}}` is the §17 sentence: this request breaches a declared
   *  Leave Conflict or the study Leave Cap, and medical is never refused by
   *  either, so this is the admins' only warning in time to arrange cover. It
   *  names the partner where a conflict is what was breached — an admin sees a
   *  colleague's Leave Type on the calendar anyway, so the redaction that shapes
   *  the instructor's refusal does not apply. It sits at the END of a line rather than on
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
    { slug: 'welcome', subject: `Welcome to ${STUDIO}`, bodyHtml: WELCOME_BODY },
    {
      slug: 'client_invite',
      subject: `Your ${STUDIO} account is ready`,
      bodyHtml: CLIENT_INVITE_BODY,
    },
    { slug: 'password_reset', subject: 'Reset your password', bodyHtml: PASSWORD_RESET_BODY },
    {
      slug: 'class_booking_confirmed',
      subject: '{{class_name}} on {{date}} is booked',
      bodyHtml: CLASS_BOOKING_BODY,
    },
    {
      slug: 'class_waitlist_promoted',
      subject: 'You’re in — {{class_name}}',
      bodyHtml: CLASS_WAITLIST_PROMOTED_BODY,
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
      subject: `You've been invited to ${STUDIO} — Admin Portal`,
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
      subject: `Welcome to ${STUDIO}`,
      bodyHtml: TRIAL_PASS_PURCHASE_BODY,
    },
    { slug: 'sign_in_code', subject: `Your ${STUDIO} sign-in code`, bodyHtml: SIGN_IN_CODE_BODY },
    {
      slug: 'staff_two_factor_code',
      subject: `Your ${STUDIO} portal verification code`,
      bodyHtml: TWO_FACTOR_CODE_BODY,
    },
    {
      slug: 'staff_password_reset',
      subject: `Set your ${STUDIO} portal password`,
      bodyHtml: STAFF_PASSWORD_RESET_BODY,
    },
  ]
}
