import type { TemplateSlug } from './send'

/**
 * Per-template variable allow-list. Powers the §17c amber flag in the fe-portal
 * template editor: PATCH /portal/admin/notifications/templates/:slug rejects
 * any {{var}} not in this list.
 */
export const TEMPLATE_VARIABLES: Record<TemplateSlug, readonly string[]> = {
  welcome: ['client_name', 'studio_name'],
  password_reset: ['client_name', 'reset_url'],
  class_booking_confirmed: ['client_name', 'class_name', 'date', 'instructor_name', 'location', 'qr_url', 'code', 'credits_remaining'],
  pt_request_submitted: ['client_name', 'instructor_name', 'starts_at'],
  pt_session_approved: ['client_name', 'instructor_name', 'starts_at', 'location', 'qr_url'],
  pt_session_declined: ['client_name', 'instructor_name', 'decline_note'],
  workshop_purchase_confirmed: ['client_name', 'workshop_name', 'date', 'qr_url', 'code', 'receipt_url'],
  class_cancelled_credit_returned: ['client_name', 'class_name', 'date', 'credits_returned'],
  class_cancelled_forfeited: ['client_name', 'class_name', 'date'],
  pt_cancelled_session_returned: ['client_name', 'instructor_name', 'starts_at'],
  pt_cancelled_forfeited: ['client_name', 'instructor_name', 'starts_at'],
  admin_cancel_class: ['client_name', 'class_name', 'date', 'credits_returned'],
  admin_cancel_pt: ['client_name', 'instructor_name', 'starts_at'],
  admin_cancel_workshop: ['client_name', 'workshop_name', 'refund_sgd'],
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
  package_purchase_confirmed: ['client_name', 'package_name', 'contents_line', 'validity_line', 'receipt_url'],
  trial_pass_purchase_confirmed: ['client_name', 'package_name', 'contents_line', 'validity_line', 'receipt_url'],
  // §14: same composed-sentence rule. `cancelled_line` names the classes the
  // Refund cancelled and states plainly when there were none — cancelling
  // someone's booked classes silently is not acceptable.
  purchase_refunded: ['client_name', 'package_name', 'refund_line', 'cancelled_line', 'account_url'],
  credit_expiry_reminder: ['client_name', 'package_name', 'expires_at', 'credits_remaining'],
  instructor_invite: ['name', 'invite_url', 'expires_at'],
  admin_invite: ['name', 'invite_url', 'expires_at'],
  client_invite: ['name', 'invitee_email', 'login_url'],
  checkin_nag: ['instructor_name', 'session_label', 'pending_count'],
  referral_credited: ['referrer_name', 'referee_name', 'credits_granted'],
}
