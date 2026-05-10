import { pgEnum } from 'drizzle-orm/pg-core'

// Identity
export const clientStatusEnum = pgEnum('client_status', ['active', 'suspended'])
export const clientGenderEnum = pgEnum('client_gender', ['female', 'male', 'non_binary', 'prefer_not_to_say'])
export const staffRoleEnum = pgEnum('staff_role', ['superadmin', 'admin', 'instructor'])
export const staffStatusEnum = pgEnum('staff_status', ['pending', 'active', 'archived'])
export const invitationStatusEnum = pgEnum('invitation_status', ['pending', 'accepted', 'revoked', 'expired'])

// Packages
export const classPackageKindEnum = pgEnum('class_package_kind', ['credit_bundle', 'unlimited'])
export const ptSessionTypeEnum = pgEnum('pt_session_type', ['1on1', '2on1'])
export const packageStatusEnum = pgEnum('package_status', ['active', 'archived'])
export const clientPackageKindEnum = pgEnum('client_package_kind', ['credit_bundle', 'unlimited', 'pt'])

// Schedule
export const lifecycleEnum = pgEnum('lifecycle', ['active', 'cancelled'])
export const ptSessionStatusEnum = pgEnum('pt_session_status', ['pending', 'confirmed', 'declined', 'cancelled'])

// Bookings
export const bookingKindEnum = pgEnum('booking_kind', ['class', 'workshop', 'pt'])
export const bookingStateEnum = pgEnum('booking_state', ['confirmed', 'cancelled', 'no_show'])
export const refundOutcomeEnum = pgEnum('refund_outcome', [
  'credit_returned',
  'session_returned',
  'stripe_refunded',
  'forfeited',
  'n_a',
])
export const checkinStateEnum = pgEnum('checkin_state', ['pending', 'attended', 'no_show', 'n_a'])
export const cancellationKindEnum = pgEnum('cancellation_kind', ['class', 'pt'])
export const cancellationSourceEnum = pgEnum('cancellation_source', ['client', 'admin'])
export const checkinMethodEnum = pgEnum('checkin_method', ['qr', 'code', 'manual'])

// Ratings
export const ratingKindEnum = pgEnum('rating_kind', ['class', 'workshop'])

// Ledger
export const auditActorTypeEnum = pgEnum('audit_actor_type', ['staff', 'system'])
export const stripePaymentKindEnum = pgEnum('stripe_payment_kind', ['workshop', 'class_package', 'pt_package'])
export const stripePaymentStatusEnum = pgEnum('stripe_payment_status', ['pending', 'succeeded', 'refunded', 'failed'])

// Content
export const emailRecipientKindEnum = pgEnum('email_recipient_kind', ['client', 'staff'])
export const emailStatusEnum = pgEnum('email_status', ['queued', 'sent', 'failed'])

// Inbox
export const inboxItemTypeEnum = pgEnum('inbox_item_type', [
  'client_cancellation',
  'admin_cancel_class_pt',
  'admin_cancel_workshop',
  'pt_request',
])
export const inboxActionEnum = pgEnum('inbox_action', ['approved', 'declined'])
