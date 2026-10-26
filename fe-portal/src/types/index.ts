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

export type ClassTypeDifficulty =
  | "general"
  | "beginner"
  | "intermediate"
  | "advanced";

export interface ClassType {
  id: string;
  name: string;
  description: string;
  difficulty: ClassTypeDifficulty;
  parentId: string | null;
  archivedAt: string | null;
}

export interface Instructor {
  id: string; // matches staff_users.id where role=instructor
  name: string;
  email: string;
  phone: string;
  bio: string;
  photoUrl: string | null;
  archivedAt: string | null;
}

// --- Capacity (cross-cutting) ---

export interface Capacity {
  waitlist: number;
  onlineBooking: number;
  buffer: number;
}

// --- Promotions (cross-cutting on packages) ---

export type PromotionMode = "percent" | "price";

export interface Promotion {
  id: string;
  label: string;
  mode: PromotionMode;
  percent: number | null;
  priceSgd: number | null;
  startsAt: string;
  endsAt: string;
}

// --- Packages (§5, §6) ---

export type ClassPackageKind = "credit_bundle" | "unlimited" | "trial";

export interface ClassPackage {
  id: string;
  name: string;
  description: string;
  kind: ClassPackageKind;
  credits: number | null;       // credit_bundle + trial
  validityDays: number | null;  // credit_bundle + trial (required for both)
  durationMonths: number | null;  // unlimited only — whole calendar months
  priceSgd: number;
  status: "active" | "archived";
  promotions: Promotion[];
}

export type PtSessionType = "1on1" | "2on1";

export interface PtPackage {
  id: string;
  name: string;
  sessionType: PtSessionType;
  numSessions: number;
  validityDays: number;  // required — a PT package always expires (1..3650)
  /**
   * Instructor-Bound: a member buying this picks one active instructor at
   * checkout and the purchase lands tied to them. Future sales only — packages
   * already sold keep the binding they were sold with.
   */
  instructorBound: boolean;
  priceSgd: number;
  status: "active" | "archived";
  promotions: Promotion[];
}

export interface ClientPackage {
  id: string;
  clientId: string;
  kind: "credit_bundle" | "unlimited" | "trial" | "pt";
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

export interface WorkshopDay {
  id: string;
  date: string;        // YYYY-MM-DD
  startTime: string;   // HH:mm
  endTime: string;     // HH:mm
  roomId: string;      // physical room this day runs in (required when scheduling)
  capacity: Capacity;
}

export interface WorkshopTier {
  id: string;
  workshopId: string;
  name: string;
  description: string;
  dayIds: string[];
  priceSgd: number;
  earlyBirdPriceSgd: number | null;
  earlyBirdCutoffAt: string | null;
}

export interface Workshop {
  id: string;
  name: string;
  locationId: string;
  mainInstructorId: string;
  supportingInstructorIds: string[];
  /** Back-compat: `[main, ...supporting]`. Read-only mirror of the two fields above. */
  instructorIds: string[];
  mainInstructorPaySgd?: number | null;
  /** Keyed by instructor id (supporting instructors only). */
  supportingInstructorPay?: Record<string, number | null>;
  descriptionHtml: string;
  days: WorkshopDay[];
  tiers: WorkshopTier[];
  /** Promotions scoped to this workshop (parent_type='workshop'). Applied uniformly across all tiers. */
  promotions: Promotion[];
  lifecycle: Lifecycle;
  cancelledAt: string | null;
  cancelledByStaffId: string | null;
}

// --- Corporate Requests ---
// Request-driven corporate flow (mirrors PT requests). A member buys a
// corporate package → BE auto-creates one pending request. Note: unlike PT,
// corporate has a SINGLE `cancelled` state (no before/after split).

export type CorporateRequestStatus =
  | "pending"
  | "scheduled"
  | "cancelled"
  | "attended";

export interface CorporateRequest {
  id: string;
  status: CorporateRequestStatus;
  preferredLocation: string | null;
  message: string | null;
  createdAt: string;
  resolvedAt: string | null;
  client: { id: string; name: string; email: string; photo_url: string | null };
  package: { id: string; name: string };
  session: null | {
    id: string;
    startsAt: string;
    endsAt: string;
    locationName: string | null;
    instructorName: string | null;
  };
}

// --- Identity (§15, §16) ---

export type StaffRole = "admin" | "instructor";
export type StaffStatus = "pending" | "active" | "archived";

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  /** Their own Profile picture, or null for initials. */
  photoUrl: string | null;
}
