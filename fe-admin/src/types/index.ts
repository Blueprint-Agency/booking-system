// Core domain types — mirror fe-client with admin extensions.

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  industry: string;
  description: string;
  shortDescription: string;
  location: string;
  logoEmoji: string;
  logoUrl: string;
  coverUrl: string;
  coverGradient: string;
  status: "active" | "incomplete" | "suspended";
  plan: "starter" | "growth" | "professional";
}

export interface Location {
  id: string;
  tenantId: string;
  name: string;
  shortName: string;
  address: string;
  area: string;
  mapUrl?: string;
  phone?: string;
  operatingHours?: { day: number; open: string; close: string; closed?: boolean }[];
}

export interface Session {
  id: string;
  tenantId: string;
  locationId: string | null;
  name: string;
  category: string;
  level: "beginner" | "intermediate" | "advanced" | "all";
  type: "regular" | "workshop" | "event";
  instructorId: string;
  capacity: number;
  bookedCount: number;
  waitlistCount: number;
  date: string;
  time: string;
  duration: number;
  price: number;
  status: "scheduled" | "cancelled" | "completed";
  recurrence: string | null;
  waitlistEnabled: boolean;
  waitlistMaxSize: number | null;
  lateCutoffMinutes: number | null;
  packageEligible: boolean;
  description: string;
  workshopPackages?: {
    name: string;
    description: string;
    price: number;
  }[];
  workshopTiers?: WorkshopTier[];
  workshopHeroImage?: string;
  workshopFeatured?: boolean;
  workshopPublished?: boolean;
  cancelledAt?: string;
  cancelReason?: string;
}

export interface WorkshopTier {
  id: string;
  label: string;
  priceCents: number;
  cutoffDate: string | null;
  active: boolean;
}

export interface Client {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  phone: string;
  registeredAt: string;
  activityStatus: "active" | "inactive";
  noShowCount: number;
  totalSessions: number;
  tags: string[];
  waiverSigned: boolean;
  waiverSignedAt: string | null;
  waiverVersion: string | null;
  lastVisit: string | null;
  internalNote: string | null;
  primaryLocationId: string | null;
}

export interface Booking {
  id: string;
  tenantId: string;
  clientId: string;
  sessionId: string;
  status: "confirmed" | "cancelled" | "waitlisted";
  checkInStatus: "pending" | "attended" | "late" | "no-show";
  packageId: string | null;
  rating: number | null;
  createdAt: string;
  cancelledAt?: string;
  cancelReason?: string;
  refunded?: boolean;
  promotedFromWaitlist?: boolean;
  source?: "client" | "walk-in" | "admin";
  checkedInAt?: string;
}

export interface Product {
  id: string;
  tenantId: string;
  name: string;
  type: "drop-in" | "package" | "membership" | "vip" | "bundle";
  category?: string;
  creditType: "class" | "pt1on1" | "pt2on1";
  priceCents: number;
  sessionCount: number | null;
  expiryDays: number | null;
  sessionsPerMonth: number | null;
  description: string;
  active: boolean;
  priceByInstructorId?: Record<string, number>;
  /** If true, package credits can be redeemed at any location. Default true. */
  crossLocation?: boolean;
}

export interface ClientPackage {
  id: string;
  clientId: string;
  productId: string;
  sessionsRemaining: number;
  sessionsTotal: number;
  purchasedAt: string;
  expiresAt: string | null;
  status: "active" | "expired" | "paused" | "cancelled";
}

export interface Invoice {
  id: string;
  tenantId: string;
  clientId: string;
  invoiceNumber: string;
  issuedAt: string;
  amountCents: number;
  status: "paid" | "pending" | "failed" | "refunded";
  paymentMethod: string;
  items: {
    id: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    amountCents: number;
    refunded?: boolean;
  }[];
}

export interface Instructor {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  phone: string;
  bio: string;
  avatarUrl: string;
  available: boolean;
  locationIds: string[];
  payRateCents: number;
  payModel: "flat" | "perAttendee" | "hourly";
  availabilityTemplateId: string | null;
  compensation?: {
    basePerSession: number;
    perClientCommission: number;
    revenueCommissionPercent: number;
    extraHourRate: number;
    workshopRate: number;
  };
}

export interface Membership {
  id: string;
  tenantId: string;
  clientId: string;
  productId: string;
  status: "active" | "cancelled" | "past_due" | "paused";
  nextBillingDate: string;
  sessionsUsedThisMonth: number;
  sessionsPerMonth: number | null;
  startedAt: string;
  pausedUntil?: string;
}

// --- admin-only extensions ---

export type AdminRole = "admin" | "instructor" | "super";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  tenantId: string;
  locationIds: string[];
  active: boolean;
  avatarUrl?: string;
}

export type AuditAction =
  | "client.create" | "client.update" | "client.merge" | "client.softDelete"
  | "credit.grant" | "credit.adjust" | "package.extend" | "package.refund"
  | "membership.pause" | "membership.cancel" | "membership.changePlan" | "invoice.refund"
  | "session.create" | "session.update" | "session.cancel"
  | "booking.cancelAdmin"
  | "private.accept" | "private.decline" | "private.proposeAlt"
  | "product.create" | "product.update" | "product.archive"
  | "promo.create" | "promo.disable"
  | "referral.approve" | "referral.deny"
  | "policy.edit" | "cms.publish" | "broadcast.send"
  | "tenant.create" | "tenant.update" | "tenant.suspend" | "featureFlag.set"
  | "refund.resolve" | "refund.decline" | "cancellation.resolve"
  | "waiver.reset" | "impersonation.start" | "impersonation.stop";

export interface AuditEntry {
  id: string;
  ts: string;
  actorId: string;
  actorRole: AdminRole;
  tenantId: string;
  impersonatingTenantId?: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  note: string | null;
}

export interface AvailabilityTemplate {
  id: string;
  instructorId: string;
  weekly: boolean[][];
}

export interface AvailabilityBlockoff {
  id: string;
  instructorId: string;
  startAt: string;
  endAt: string;
  reason: string | null;
}

export interface PrivateRequest {
  id: string;
  tenantId: string;
  clientId: string;
  instructorId: string;
  productId: string;
  requestedAt: string;
  requestedSlotIso: string;
  slaDueAt: string;
  status: "pending" | "accepted" | "declined" | "alt_proposed";
  proposedSlotIso?: string;
  responseNote?: string;
}

export interface ReferralCode {
  code: string;
  tenantId: string;
  ownerClientId: string;
  discountCents: number;
  usageCap: number;
  usedCount: number;
  status: "active" | "disabled";
  createdAt: string;
}

export interface ReferralEvent {
  id: string;
  code: string;
  tenantId: string;
  referrerClientId: string;
  refereeClientId: string;
  status: "pending" | "joined" | "credited" | "denied";
  createdAt: string;
}

export interface Promo {
  id: string;
  tenantId: string;
  code: string;
  discountType: "amount" | "percent";
  discountValue: number;
  startsAt: string;
  endsAt: string;
  usageCap: number;
  usedCount: number;
  perUserCap: number;
  productIds: string[];
  active: boolean;
}

export interface NotificationTemplate {
  slug: string;
  tenantId: string;
  subject: string;
  body: string;
  channel: "email" | "sms";
}

export interface Broadcast {
  id: string;
  tenantId: string;
  templateSlug: string | null;
  subject: string;
  body: string;
  audience: { kind: "all" | "tag" | "ids"; value?: string | string[] };
  status: "draft" | "scheduled" | "sent";
  scheduledAt?: string;
  sentAt?: string;
}

export interface Announcement {
  id: string;
  tenantId: string;
  message: string;
  active: boolean;
  startsAt: string;
  endsAt: string;
}

export interface CmsBlock {
  id: string;
  tenantId: string;
  kind:
    | "heroRotatingWords"
    | "featureGrid"
    | "showcaseGrid"
    | "testimonials"
    | "ctaBanner"
    | "featureDeepDive";
  payload: unknown;
  publishedAt: string | null;
}

export interface CmsHistory {
  id: string;
  blockId: string;
  ts: string;
  payload: unknown;
  actorId: string;
}

export interface SuperTenantView {
  tenantId: string;
  name: string;
  plan: string;
  status: "active" | "suspended" | "trial";
  mrrCents: number;
  activeClients: number;
  activeInstructors: number;
  lastLoginAt: string;
}

export interface SaasPlan {
  id: string;
  name: string;
  priceCents: number;
  seatLimit: number;
  features: string[];
}

export interface TenantBillingInvoice {
  id: string;
  tenantId: string;
  issuedAt: string;
  amountCents: number;
  status: "paid" | "failed" | "pending";
}

export interface FeatureFlag {
  key: string;
  tenantId: string | "*";
  enabled: boolean;
}

export interface WalkIn {
  id: string;
  tenantId: string;
  sessionId: string;
  name: string;
  phone: string;
  createdAt: string;
  clientIdCreated?: string;
}

export interface SessionTemplate {
  id: string;
  tenantId: string;
  name: string;
  category: string;
  level: "beginner" | "intermediate" | "advanced" | "all";
  duration: number;
  defaultPriceCents: number;
  defaultInstructorId: string | null;
  locationIds: string[];
  recurrence: string | null;
  time: string;
  packageEligible: boolean;
  creditType?: "class" | "pt1on1" | "pt2on1";
  description: string;
  active: boolean;
}

export interface PolicyState {
  classCancelHours: number;
  privateCancelHours: number;
  privateSlaHours: number;
  lastMinuteThreshold: number;
}

export type InboxStatus = "open" | "resolved" | "declined";

export interface RefundRequest {
  id: string;
  clientId: string;
  invoiceId?: string | null;
  bookingId?: string | null;
  amountCents: number;
  reason: string;
  channel: "whatsapp" | "email" | "in-person";
  status: InboxStatus;
  openedAt: string;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
}

export interface CancellationRequest {
  id: string;
  clientId: string;
  bookingId?: string | null;
  membershipId?: string | null;
  reason: string;
  channel: "whatsapp" | "email" | "in-person";
  status: Exclude<InboxStatus, "declined">;
  openedAt: string;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
}
