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
  package_purchase_confirmed: ['client_name', 'package_name', 'credits_or_sessions', 'expires_at', 'receipt_url'],
  credit_expiry_reminder: ['client_name', 'package_name', 'expires_at', 'credits_remaining'],
  instructor_invite: ['name', 'invite_url', 'expires_at'],
  admin_invite: ['name', 'invite_url', 'expires_at'],
  client_invite: ['name', 'invitee_email', 'login_url'],
  checkin_nag: ['instructor_name', 'session_label', 'pending_count'],
  referral_credited: ['referrer_name', 'referee_name', 'credits_granted'],
}
