import type { TemplateSlug } from './send'

/**
 * Per-template variable allow-list. Powers the §17c amber flag in the fe-portal
 * template editor: PATCH /portal/admin/notifications/templates/:slug rejects
 * any {{var}} not in this list.
 */
export const TEMPLATE_VARIABLES: Record<TemplateSlug, readonly string[]> = {
  welcome: ['client_name'],
  password_reset: ['client_name', 'reset_url'],
  // NTF-08: `credits_line` is a whole composed sentence (./booking-email.ts) —
  // the credits used and what remains, or, on an Unlimited Plan, that it used
  // none. It replaces `credits_remaining`, a bare count that read "0" on a plan
  // with no balance. The sender still supplies `credits_used` and
  // `credits_remaining` for a studio's own wording that uses them.
  class_booking_confirmed: ['client_name', 'class_name', 'date', 'instructor_name', 'location', 'qr_url', 'code', 'credits_line'],
  // A waitlist promotion booked the member in (spec-waitlist.md §11). `cancel_by`
  // is the moment the Cancellation Window closes on the class.
  class_waitlist_promoted: ['client_name', 'class_name', 'date', 'time', 'location_name', 'instructor_name', 'cancel_by'],
  pt_request_submitted: ['client_name', 'instructor_name', 'starts_at'],
  pt_session_approved: ['client_name', 'instructor_name', 'starts_at', 'location', 'qr_url'],
  pt_session_declined: ['client_name', 'instructor_name', 'decline_note'],
  pt_request_expired: ['client_name', 'instructor_name', 'starts_at'],
  // NTF-11 (admin-restructure §9e): one email whether the request was
  // cancelled before or after it was scheduled. `session_line` names it — a
  // scheduled session by instructor and time, else "Your private session
  // request" — and `refund_line` is empty when no session came back.
  pt_request_cancelled: ['client_name', 'session_line', 'refund_line', 'account_url'],
  // A purchase confirmation is the member's receipt (#370), so it states what
  // was paid: `amount_paid` is the figure with its currency ("S$120.00"),
  // and the zero amount on a free tier. Same variable on the package and trial
  // confirmations below.
  workshop_purchase_confirmed: ['client_name', 'workshop_name', 'date', 'qr_url', 'code', 'amount_paid', 'receipt_url'],
  // The waitlist offer is time-bound (fe-client §4.1): the place goes to the
  // next person if it is not claimed, so the deadline is part of the email.
  workshop_waitlist_promoted: ['client_name', 'workshop_name', 'date', 'claim_url', 'claim_deadline'],
  // NTF-09/10: `refund_line` is a composed sentence (./booking-email.ts), and a
  // link is a variable (`classes_url`, `account_url`, `workshops_url`,
  // `checkin_url`) built per send from the studio's own origin, so the default
  // wording names no origin and a data migration can write it (migration 0108).
  // The senders still supply the variables these replaced
  // (`credits_returned`, `refund_sgd`) for a studio's own wording.
  class_cancelled_credit_returned: ['client_name', 'class_name', 'date', 'refund_line', 'classes_url'],
  // `reason_line` is a whole composed sentence (policy/evaluate-cancellation.ts:
  // `forfeitLine`): a forfeit has four causes and only two are lateness, so a
  // fixed sentence is false for the member who cancelled in good time and
  // merely ran past the cap.
  class_cancelled_forfeited: ['client_name', 'class_name', 'date', 'reason_line'],
  pt_cancelled_session_returned: ['client_name', 'instructor_name', 'starts_at', 'refund_line', 'account_url'],
  pt_cancelled_forfeited: ['client_name', 'instructor_name', 'starts_at', 'reason_line'],
  admin_cancel_class: ['client_name', 'class_name', 'date', 'refund_line', 'classes_url'],
  // The studio changed which packages a class accepts, and the one that paid for
  // this booking is no longer one of them (services/schedule/package-rules.ts).
  class_rule_cancelled: ['client_name', 'class_name', 'date', 'package_name', 'credits_returned'],
  admin_cancel_pt: ['client_name', 'instructor_name', 'starts_at', 'refund_line', 'account_url'],
  // `refund_line` is a whole sentence: what the member paid, in the shared money
  // form ("S$120.00", `sgdText`), and that the studio is arranging the refund —
  // nothing is refunded automatically when a workshop is cancelled (#272) — or,
  // for a place that was free, the amount alone.
  admin_cancel_workshop: ['client_name', 'workshop_name', 'refund_line', 'workshops_url'],
  // Goes to admins, not clients — the instructor cancelled their own class.
  instructor_cancel_class: ['class_name', 'date', 'instructor_name', 'reason', 'refunded_count'],
  // Leave: the first goes to every admin, the other three back to the instructor.
  // `reason` is the instructor's on submission and the admin's on rejection.
  // §17: `cap_warning` is a whole sentence built in ./leave rules, empty unless
  // the request puts the studio over a Leave Cap — which only medical ever does,
  // because every other type is refused at submission.
  leave_request_submitted: ['instructor_name', 'leave_type', 'dates', 'days', 'reason', 'cap_warning'],
  leave_approved: ['instructor_name', 'leave_type', 'dates', 'days'],
  leave_rejected: ['instructor_name', 'leave_type', 'dates', 'days', 'reason'],
  // A revocation undoes an approval, so it names who did it and when.
  leave_revoked: ['instructor_name', 'leave_type', 'dates', 'days', 'revoked_by', 'revoked_at'],
  // §13: `contents_line` and `validity_line` REPLACE `credits_or_sessions` and
  // `expires_at`. Each is a whole composed sentence, built by kind in
  // ./purchase-email.ts — the fragment-shaped pair produced a wrong sentence for
  // some kind whatever the template said around them, and leaving them in the
  // allow-list would leave that footgun loaded for the portal template editor.
  //
  // #387: on these four `receipt_url` is the member's Receipt in the booking
  // app, and `services/receipts/email.ts:withReceipt` also fills
  // `receipt_number` and draws the receipt block under the copy. No default
  // copy shows `receipt_number`, and this list holds what the defaults show
  // (db/seed/email-copy.test.ts), so it is not listed here.
  package_purchase_confirmed: ['client_name', 'package_name', 'contents_line', 'validity_line', 'amount_paid', 'receipt_url'],
  trial_pass_purchase_confirmed: ['client_name', 'package_name', 'contents_line', 'validity_line', 'amount_paid', 'receipt_url'],
  // A paid corporate package (be-client § Corporate branch, step 5). It grants
  // no credits and has no validity, so no `contents_line` or `validity_line`:
  // what was bought is the pending Corporate Request the studio now arranges.
  // `amount_paid` in the shared money form, as on the confirmations above.
  corporate_purchase_confirmed: ['client_name', 'package_name', 'amount_paid', 'receipt_url'],
  // #388: Merch and a standalone Cross-Location Add-On, sent only with a
  // Receipt to carry, so `receipt_url` is always the member's Receipt and
  // `withReceipt` fills `receipt_number` too (not listed, as on the four
  // above). `item_name` is what was bought, in the Receipt's own phrase:
  // the item, or the first line "+ N more".
  purchase_receipt: ['client_name', 'item_name', 'amount_paid', 'receipt_url'],
  // §14: same composed-sentence rule. `cancelled_line` names the classes the
  // Refund cancelled and states plainly when there were none — cancelling
  // someone's booked classes silently is not acceptable.
  purchase_refunded: ['client_name', 'package_name', 'refund_line', 'cancelled_line', 'account_url'],
  // `remaining_line` rather than a bare count: this one reminder also serves a
  // trial pass, and a trial holds classes — it has never heard of a credit.
  // Compose it with `./purchase-email.ts:contentsLine`, which already speaks
  // every kind.
  credit_expiry_reminder: ['client_name', 'package_name', 'expires_at', 'remaining_line'],
  instructor_invite: ['name', 'invite_url', 'expires_at'],
  admin_invite: ['name', 'invite_url', 'expires_at'],
  client_invite: ['name', 'invitee_email', 'login_url'],
  // NTF-18: sent to the Instructor and copied to each active Admin, so the copy
  // greets nobody by name; `checkin_url` is the recipient's own check-in desk.
  checkin_nag: ['instructor_name', 'session_label', 'date', 'pending_count', 'checkin_url'],
  referral_credited: ['referrer_name', 'referee_name', 'credits_granted'],
  // Sign-in (services/auth/better-auth.ts). `code` and `reset_url` are credentials and
  // are sent as `secretVariables`, so `email_log` keeps them redacted.
  sign_in_code: ['code'],
  staff_two_factor_code: ['name', 'code'],
  staff_password_reset: ['name', 'reset_url'],
}
