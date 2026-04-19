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
}

export interface Client {
  id: string;
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
}

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

export interface Product {
  id: string;
  name: string;
  type: "drop-in" | "package" | "membership";
  creditType: "class" | "pt";
  price: number;
  sessionCount: number | null;
  expiryDays: number | null;
  sessionsPerMonth: number | null;
  description: string;
  active: boolean;
}

export interface ClientPackage {
  id: string;
  clientId: string;
  productId: string;
  sessionsRemaining: number;
  sessionsTotal: number;
  purchasedAt: string;
  expiresAt: string | null;
  status: "active" | "expired";
}

export interface Invoice {
  id: string;
  clientId: string;
  invoiceNumber: string;
  date: string;
  amount: number;
  status: "paid" | "pending";
  paymentMethod: string;
  items: {
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }[];
}

export interface Instructor {
  id: string;
  name: string;
  email: string;
  phone: string;
  bio: string;
  avatarUrl: string;
  available: boolean;
  locationIds: string[];
  compensation: {
    basePerSession: number;
    perClientCommission: number;
    revenueCommissionPercent: number;
    extraHourRate: number;
    workshopRate: number;
  };
}

export interface Membership {
  id: string;
  clientId: string;
  productId: string;
  status: "active" | "cancelled" | "past_due";
  nextBillingDate: string;
  sessionsUsedThisMonth: number;
  sessionsPerMonth: number | null;
  startedAt: string;
}

export interface MockUser {
  id: string;
  name: string;
  email: string;
  role: "client" | "admin" | "instructor" | "staff";
  avatar: string;
}
