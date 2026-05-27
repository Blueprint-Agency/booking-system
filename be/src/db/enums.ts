import { pgEnum } from 'drizzle-orm/pg-core'

// Identity
export const clientStatusEnum = pgEnum('client_status', ['active', 'suspended'])
export const clientGenderEnum = pgEnum('client_gender', ['female', 'male', 'non_binary', 'prefer_not_to_say'])
export const staffRoleEnum = pgEnum('staff_role', ['superadmin', 'admin', 'instructor'])
export const staffStatusEnum = pgEnum('staff_status', ['pending', 'active', 'archived'])
export const invitationStatusEnum = pgEnum('invitation_status', ['pending', 'accepted', 'revoked', 'expired'])

// Packages
export const classPackageKindEnum = pgEnum('class_package_kind', ['credit_bundle', 'unlimited', 'trial'])
export const ptSessionTypeEnum = pgEnum('pt_session_type', ['1on1', '2on1'])
export const packageStatusEnum = pgEnum('package_status', ['active', 'archived'])
export const clientPackageKindEnum = pgEnum('client_package_kind', ['credit_bundle', 'unlimited', 'trial', 'pt'])

// Promotions (§4d)
export const promotionParentEnum = pgEnum('promotion_parent', ['class_package', 'pt_package', 'workshop'])
export const promotionKindEnum = pgEnum('promotion_kind', ['percent', 'special_price'])
export const promotionStatusEnum = pgEnum('promotion_status', ['active', 'archived'])

// Schedule
export const lifecycleEnum = pgEnum('lifecycle', ['active', 'cancelled'])
// Workshop / class / corporate session instructor role (§4.3)
export const workshopInstructorRoleEnum = pgEnum('workshop_instructor_role', ['main', 'supporting'])
export type WorkshopInstructorRole = (typeof workshopInstructorRoleEnum.enumValues)[number]
// `pt_session_status` enum is REMOVED — PT request states now live on pt_requests via pt_request_status.
// Lifecycle (no admin approval step — scheduling is the implicit approval):
//   pending                      — client submitted, admin hasn't scheduled yet
//   scheduled                    — admin scheduled the session (pt_session row created)
//   cancelled_before_scheduled   — cancelled while pending (by client or admin); credits refunded
//   cancelled_after_scheduled    — cancelled after scheduling (by client or admin); NO refund (v1)
//   attended                     — derived from the booking check-in; mirrored here for queue display
export const ptRequestStatusEnum = pgEnum('pt_request_status', [
  'pending',
  'scheduled',
  'cancelled_before_scheduled',
  'cancelled_after_scheduled',
  'attended',
])

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

// Ledger
export const auditActorTypeEnum = pgEnum('audit_actor_type', ['staff', 'system'])
export const stripePaymentKindEnum = pgEnum('stripe_payment_kind', ['workshop', 'class_package', 'pt_package'])
export const stripePaymentStatusEnum = pgEnum('stripe_payment_status', ['pending', 'succeeded', 'refunded', 'failed'])

// Content
export const emailRecipientKindEnum = pgEnum('email_recipient_kind', ['client', 'staff'])
// Spec §4j uses `email_log` with a `status` column. The pgEnum is named `email_log_status` per
// backend-architecture.md §4 enum list; the existing migration named the pg enum `email_status`
// — we rename here to track the spec. The column reference is updated in `content.ts`.
export const emailLogStatusEnum = pgEnum('email_log_status', ['queued', 'sent', 'failed'])

// Inbox — `pt_request` value REMOVED per §4l. PT triage moved to `/admin/pt-requests`.
export const inboxItemTypeEnum = pgEnum('inbox_item_type', [
  'client_cancellation',
  'admin_cancel_class_pt',
  'admin_cancel_workshop',
])
// `inbox_action` enum is no longer used — action_taken/action_at/action_by_staff_id columns
// were removed from inbox_items per §4l. Enum left undeclared (drop in migration SQL).

// TS type aliases (handy for service layer)
export type StaffRole = (typeof staffRoleEnum.enumValues)[number]
export type StaffStatus = (typeof staffStatusEnum.enumValues)[number]
export type ClientPackageKind = (typeof clientPackageKindEnum.enumValues)[number]
export type ClassPackageKind = (typeof classPackageKindEnum.enumValues)[number]
export type PromotionParent = (typeof promotionParentEnum.enumValues)[number]
export type PromotionKind = (typeof promotionKindEnum.enumValues)[number]
export type PtRequestStatus = (typeof ptRequestStatusEnum.enumValues)[number]
export type BookingKind = (typeof bookingKindEnum.enumValues)[number]
export type BookingState = (typeof bookingStateEnum.enumValues)[number]
export type Lifecycle = (typeof lifecycleEnum.enumValues)[number]
