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
// Corporate purchases deliberately do NOT create a client_packages row: they carry no
// credits and the corporate_request IS the entitlement. (A 'corporate' kind here would
// pollute listClientPackages, which renders the class/PT wallet.) The purchase record is
// the corporate_request + a stripe_payments row (kind='corporate_package').
export const clientPackageKindEnum = pgEnum('client_package_kind', ['credit_bundle', 'unlimited', 'trial', 'pt'])

// Promotions (§4d)
export const promotionParentEnum = pgEnum('promotion_parent', ['class_package', 'pt_package', 'workshop'])
export const promotionKindEnum = pgEnum('promotion_kind', ['percent', 'special_price'])
export const promotionStatusEnum = pgEnum('promotion_status', ['active', 'archived'])

// Promo Codes (spec-pre-launch-batch.md §9–§11). A Promo Code is typed by the
// member, reaches across products and is capped; a Promotion applies itself to
// one product inside a window. Distinct mechanisms, distinct tables, distinct
// enums — see be/CONTEXT.md § Discounts.
// No `special_price` kind: a code spans many products, so "this costs $89
// instead" cannot mean anything across them.
export const promoCodeKindEnum = pgEnum('promo_code_kind', ['percent', 'amount'])
export const promoCodeStatusEnum = pgEnum('promo_code_status', ['active', 'archived'])
export const promoCodeProductEnum = pgEnum('promo_code_product', ['class_package', 'pt_package', 'workshop'])
// held → the checkout claimed a place; consumed → payment succeeded;
// refunded → the money went back and the place is free again.
export const promoCodeRedemptionStatusEnum = pgEnum('promo_code_redemption_status', [
  'held',
  'consumed',
  'refunded',
])

// Schedule
export const lifecycleEnum = pgEnum('lifecycle', ['active', 'cancelled'])
// Class-type difficulty (§ catalog). Values mirror the fe-portal `ClassTypeDifficulty`
// union. `general` = "all levels" and is the default for existing/new types.
export const classDifficultyEnum = pgEnum('class_difficulty', [
  'general',
  'beginner',
  'intermediate',
  'advanced',
])
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

// Corporate request lifecycle. Mirrors pt_request_status but simpler: corporate
// has no slots, so there's no pre/post-schedule cancel split — one `cancelled`.
//   pending    — client purchased, admin hasn't scheduled yet (negotiated via WhatsApp)
//   scheduled  — admin scheduled the corporate_session
//   cancelled  — cancelled while pending or after scheduling (by client or admin)
//   attended   — admin marked the scheduled session as delivered
export const corporateRequestStatusEnum = pgEnum('corporate_request_status', [
  'pending',
  'scheduled',
  'cancelled',
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
export const cancellationSourceEnum = pgEnum('cancellation_source', ['client', 'admin', 'instructor'])
export const checkinMethodEnum = pgEnum('checkin_method', ['qr', 'code', 'manual'])

// Instructor leave (docs/md/spec-instructor-leave.md)
export const leaveTypeEnum = pgEnum('leave_type', ['annual', 'medical', 'study'])
// withdrawn = instructor abandons a pending request; cancelled = instructor gives
// back approved leave; revoked = an admin takes approved leave away.
export const leaveStatusEnum = pgEnum('leave_status', [
  'pending',
  'approved',
  'rejected',
  'withdrawn',
  'cancelled',
  'revoked',
])
// 'none' = a full day. morning/afternoon are accepted by the schema but refused
// at submission until half days land (ticket 05).
export const leaveHalfDayEnum = pgEnum('leave_half_day', ['none', 'morning', 'afternoon'])

// Ledger
export const auditActorTypeEnum = pgEnum('audit_actor_type', ['staff', 'system'])
export const stripePaymentKindEnum = pgEnum('stripe_payment_kind', ['workshop', 'class_package', 'pt_package', 'corporate_package'])
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
  'instructor_cancel_class',
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
export type PromoCodeKind = (typeof promoCodeKindEnum.enumValues)[number]
export type PromoCodeStatus = (typeof promoCodeStatusEnum.enumValues)[number]
export type PromoCodeProduct = (typeof promoCodeProductEnum.enumValues)[number]
export type PromoCodeRedemptionStatus = (typeof promoCodeRedemptionStatusEnum.enumValues)[number]
export type PtRequestStatus = (typeof ptRequestStatusEnum.enumValues)[number]
export type CorporateRequestStatus = (typeof corporateRequestStatusEnum.enumValues)[number]
export type BookingKind = (typeof bookingKindEnum.enumValues)[number]
export type BookingState = (typeof bookingStateEnum.enumValues)[number]
export type Lifecycle = (typeof lifecycleEnum.enumValues)[number]
export type LeaveType = (typeof leaveTypeEnum.enumValues)[number]
export type LeaveStatus = (typeof leaveStatusEnum.enumValues)[number]
export type LeaveHalfDay = (typeof leaveHalfDayEnum.enumValues)[number]
export type ClassDifficulty = (typeof classDifficultyEnum.enumValues)[number]
