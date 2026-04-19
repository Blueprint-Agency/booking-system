// --- Tenant ---
export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: "starter" | "growth" | "professional";
  status: "active" | "incomplete" | "suspended";
  createdAt: string;
}

// --- Location ---
export interface Location {
  id: string;
  tenantId: string;
  name: string;
  shortName: string;
  address: string;
  area: string;
  mapUrl?: string;
  rooms?: number;
  amenities?: string[];
}

// --- Instructor ---
export interface Instructor {
  id: string;
  tenantId: string;
  name: string;
  bio: string;
  photo: string;
  specialties: string[];
  availability?: InstructorAvailability[];
}

export interface InstructorAvailability {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sun
  startTime: string; // "HH:mm"
  endTime: string;
}

// --- Client ---
export interface Client {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
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
  referralCode: string;
  referredBy: string | null;
  notes?: string;
}

// --- Session ---
export interface Session {
  id: string;
  tenantId: string;
  locationId: string | null;
  templateId: string | null;
  name: string;
  category: string;
  level: "beginner" | "intermediate" | "advanced" | "all";
  type: "regular" | "workshop" | "private";
  instructorId: string;
  capacity: number;
  bookedCount: number;
  waitlistCount: number;
  date: string;      // YYYY-MM-DD
  time: string;      // HH:mm
  duration: number;  // minutes
  price: number;     // SGD; 0 for credit-based
  status: "scheduled" | "cancelled" | "completed";
  recurrence: string | null;
}

// --- Session Template (admin-only) ---
export interface SessionTemplate {
  id: string;
  tenantId: string;
  locationId: string;
  name: string;
  category: string;
  level: Session["level"];
  instructorId: string;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  time: string;
  duration: number;
  capacity: number;
  creditCost: number;
  active: boolean;
}

// --- Booking ---
export interface Booking {
  id: string;
  clientId: string;
  sessionId: string;
  status: "confirmed" | "cancelled" | "waitlisted";
  checkInStatus: "pending" | "attended" | "late" | "no-show";
  packageId: string | null;
  rating: number | null;
  createdAt: string;
  promotedFromWaitlist?: boolean;
}

// --- Product / Package catalogue ---
export interface Product {
  id: string;
  tenantId: string;
  name: string;
  type: "package" | "membership" | "workshop" | "private-pack";
  creditType: "class" | "pt" | "none";
  price: number;
  sessionCount: number | null;
  expiryDays: number | null;
  sessionsPerMonth: number | null;
  description: string;
  active: boolean;
}

// --- Client Package (instance of a purchased product) ---
export interface ClientPackage {
  id: string;
  clientId: string;
  productId: string;
  purchasedAt: string;
  expiresAt: string;
  creditsTotal: number;
  creditsRemaining: number;
  status: "active" | "expired" | "depleted";
}

// --- Membership ---
export interface Membership {
  id: string;
  clientId: string;
  productId: string;
  startsAt: string;
  endsAt: string;
  status: "active" | "paused" | "cancelled" | "expired";
}

// --- Invoice ---
export interface Invoice {
  id: string;
  clientId: string;
  issuedAt: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: "paid" | "refunded" | "partially-refunded" | "void";
  paymentMethod: "stripe" | "manual";
  referenceId?: string;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  amount: number;
}

// --- Private Session Request (admin-only) ---
export interface PrivateRequest {
  id: string;
  clientId: string;
  preferredInstructorId: string | null;
  proposedSlots: { date: string; time: string }[];
  notes: string;
  submittedAt: string;
  deadlineAt: string;                       // 12h from submittedAt
  status: "pending" | "approved" | "declined";
  resolution?: {
    resolvedAt: string;
    resolvedBy: string;                      // admin user id
    scheduledDate?: string;
    scheduledTime?: string;
    declineReason?: string;
  };
}

// --- Admin User ---
export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

// --- Audit rows ---
export interface CreditAdjustment {
  id: string;
  clientId: string;
  packageId: string | null;
  delta: number;
  reason: string;
  adminId: string;
  createdAt: string;
}

export interface Refund {
  id: string;
  invoiceId: string;
  amount: number;
  reason: string;
  adminId: string;
  createdAt: string;
}

export interface SessionCancellation {
  id: string;
  sessionId: string;
  reason: string;
  adminId: string;
  creditsRefunded: number;
  clientsAffected: string[];
  createdAt: string;
}

// --- Waiver ---
export interface WaiverSignature {
  clientId: string;
  version: string;
  signedAt: string;
  status: "current" | "outdated";
}

// --- Email template ---
export interface EmailTemplate {
  event: string;           // e.g. "booking-confirmed"
  subject: string;
  body: string;            // mustache-like placeholders, e.g. {{client.firstName}}
  updatedAt: string;
}
