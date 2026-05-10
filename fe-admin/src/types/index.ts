// Domain types — mirrors docs/md/admin-restructure.md and docs/md/backend-architecture.md.
// All schema names match the backend doc §4 so wiring later is mechanical.

// --- Building Blocks (§1-§3) ---

export interface Location {
  id: string;
  name: string;
  address: string;
  gmapsUrl: string;
  phone: string;
  archivedAt: string | null;
}

export interface ClassType {
  id: string;
  name: string;
  archivedAt: string | null;
}

export interface Instructor {
  id: string; // matches staff_users.id where role=instructor
  name: string;
  email: string;
  phone: string;
  bio: string;
  photoUrl: string | null;
  eligibleClassTypeIds: string[];
  archivedAt: string | null;
}

// --- Policy (§4, §6 booking config) ---

export interface GlobalPolicy {
  cancelCapCount: number;
  cancelCapCycleDays: number;
  classWindowHours: number;
  ptWindowHours: number;
  updatedAt: string;
}

export interface PtBookingConfig {
  bookInAdvanceDays: number;
}

// --- Packages (§5, §6) ---

export type ClassPackageKind = "credit_bundle" | "unlimited";

export interface ClassPackage {
  id: string;
  name: string;
  kind: ClassPackageKind;
  credits: number | null;       // credit_bundle only
  validityDays: number | null;  // credit_bundle only
  durationDays: number | null;  // unlimited only
  priceSgd: number;
  status: "active" | "archived";
}

export type PtSessionType = "1on1" | "2on1";

export interface PtPackage {
  id: string;
  name: string;
  sessionType: PtSessionType;
  numSessions: number;
  priceSgd: number;
  status: "active" | "archived";
}

export interface ClientPackage {
  id: string;
  clientId: string;
  kind: "credit_bundle" | "unlimited" | "pt";
  sourcePackageId: string;
  packageName: string;          // denormalised for display
  creditsOrSessionsRemaining: number | null;
  creditsOrSessionsTotal: number | null;
  expiresAt: string | null;
  purchasedAt: string;
  amountPaidSgd: number;
}

// --- Schedule (§7, §8, §10) ---

export type Lifecycle = "active" | "cancelled";
export type EventState = "scheduled" | "ongoing" | "completed" | "cancelled";

export interface ClassInstance {
  id: string;
  classTypeId: string;
  instructorId: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  creditCost: number;
  lifecycle: Lifecycle;
  cancelledAt: string | null;
  cancelledByStaffId: string | null;
}

export interface Workshop {
  id: string;
  name: string;
  classTypeId: string;
  coverUrl: string | null;
  additionalImages: string[];
  descriptionHtml: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
  instructorIds: string[];
  lifecycle: Lifecycle;
  cancelledAt: string | null;
  cancelledByStaffId: string | null;
}

export interface WorkshopTier {
  id: string;
  workshopId: string;
  name: string;
  description: string;
  regularPriceSgd: number;
  earlyBirdPriceSgd: number | null;
  earlyBirdQuota: number | null;
  earlyBirdCutoffAt: string | null;
  capacity: number;
  ord: number;
}

export type PtSessionStatus = "pending" | "confirmed" | "declined" | "cancelled";

export interface PtSession {
  id: string;
  instructorId: string;
  locationId: string | null;
  startsAt: string;
  endsAt: string;
  sessionType: PtSessionType;
  status: PtSessionStatus;
  declineNote: string | null;
  clientIds: string[];
  message: string | null;       // request message at submit time
  createdAt: string;
}

// --- Availability (§8) ---

export interface AvailabilityRecurring {
  id: string;
  instructorId: string;
  weekday: number;       // 0 = Sunday
  startTime: string;     // "HH:mm"
  endTime: string;
}

export interface AvailabilityOneOff {
  id: string;
  instructorId: string;
  startsAt: string;
  endsAt: string;
}

// --- Bookings (§10, §12) ---

export type BookingKind = "class" | "workshop" | "pt";
export type BookingState = "confirmed" | "cancelled" | "no_show";
export type CheckInState = "pending" | "attended" | "no_show" | "n_a";
export type RefundOutcome =
  | "credit_returned"
  | "session_returned"
  | "stripe_refunded"
  | "forfeited"
  | "n_a";

export interface Booking {
  id: string;
  clientId: string;
  kind: BookingKind;
  classId: string | null;
  workshopId: string | null;
  workshopTierId: string | null;
  ptSessionId: string | null;
  clientPackageId: string | null;
  state: BookingState;
  creditsOrSessionsUsed: number | null;
  refundOutcome: RefundOutcome;
  checkInState: CheckInState;
  qrToken: string;
  code: string;
  bookedAt: string;
  cancelledAt: string | null;
}

// --- Ratings (§14) ---

export interface Rating {
  id: string;
  bookingId: string;
  clientId: string;
  kind: "class" | "workshop";
  classId: string | null;
  workshopId: string | null;
  instructorId: string;
  stars: number;
  comment: string | null;
  ratedAt: string;
}

// --- Cancellations (drives §4 cap) ---

export interface CancellationRecord {
  id: string;
  bookingId: string;
  clientId: string;
  kind: "class" | "pt";
  source: "client" | "admin";
  cancelledAt: string;
  wasWithinWindow: boolean;
  wasWithinCap: boolean;
  refundFired: boolean;
}

// --- Manual adjustments (§16d) ---

export interface ManualAdjustment {
  id: string;
  clientId: string;
  clientPackageId: string;
  delta: number;
  reason: string;
  actedByStaffId: string;
  createdAt: string;
}

// --- Identity (§15, §16) ---

export type StaffRole = "superadmin" | "admin" | "instructor";
export type StaffStatus = "pending" | "active" | "archived";

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  archivedAt: string | null;
  archivedByStaffId: string | null;
  invitedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

export interface StaffInvitation {
  id: string;
  email: string;
  role: "admin" | "instructor";
  expiresAt: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedByStaffId: string;
  createdAt: string;
}

export type ClientStatus = "active" | "suspended";

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: ClientStatus;
  joinedAt: string;
  suspendedAt: string | null;
  referredByClientId: string | null;
  waiverSignedAt: string;
}

// --- Inbox (§13) ---

export type InboxType =
  | "client_cancellation"
  | "admin_cancel_class_pt"
  | "admin_cancel_workshop"
  | "pt_request";

export interface InboxItem {
  id: string;
  type: InboxType;
  payload: Record<string, unknown>;
  readAt: string | null;
  sourcePtSessionId: string | null;
  actionTaken: "approved" | "declined" | null;
  actionAt: string | null;
  createdAt: string;
}

// --- Notifications (§17) ---

export type EmailTemplateSlug =
  | "welcome"
  | "password_reset"
  | "class_booking_confirmed"
  | "pt_request_submitted"
  | "pt_session_approved"
  | "pt_session_declined"
  | "workshop_purchase_confirmed"
  | "class_cancelled_credit_returned"
  | "class_cancelled_forfeited"
  | "pt_cancelled_session_returned"
  | "pt_cancelled_forfeited"
  | "admin_cancel_class"
  | "admin_cancel_pt"
  | "admin_cancel_workshop"
  | "rating_prompt_class"
  | "rating_prompt_workshop"
  | "package_purchase_confirmed"
  | "credit_expiry_reminder"
  | "instructor_invite"
  | "admin_invite"
  | "checkin_nag";

export interface EmailTemplate {
  slug: EmailTemplateSlug;
  category: string;
  label: string;
  description: string;
  trigger: string;
  recipient: string;
  variables: string[];
  subject: string;
  bodyHtml: string;
  updatedAt: string;
}

// --- Waiver (§18) ---

export interface Waiver {
  bodyHtml: string;
  updatedAt: string;
}
