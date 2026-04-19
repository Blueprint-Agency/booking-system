"use client";
import { useSyncExternalStore } from "react";
import type {
  Location,
  AdminUser,
  Client,
  ClientPackage,
  Instructor,
  Session,
  SessionTemplate,
  Booking,
  Product,
  Promo,
  Invoice,
  AvailabilityTemplate,
  AvailabilityBlockoff,
  PrivateRequest,
  ReferralCode,
  ReferralEvent,
  WalkIn,
  AuditEntry,
  NotificationTemplate,
  Broadcast,
  Announcement,
  FeatureFlag,
  Membership,
  PolicyState,
  RefundRequest,
  CancellationRequest,
} from "@/types";
import { DEFAULT_POLICY } from "./policy";

import locationsSeed from "@/data/locations.json";
import adminUsersSeed from "@/data/admin-users.json";
import clientsSeed from "@/data/clients.json";
import clientPackagesSeed from "@/data/client-packages.json";
import instructorsSeed from "@/data/instructors.json";
import sessionsSeed from "@/data/sessions.json";
import sessionTemplatesSeed from "@/data/session-templates.json";
import bookingsSeed from "@/data/bookings.json";
import productsSeed from "@/data/products.json";
import membershipsSeed from "@/data/memberships.json";
import promosSeed from "@/data/promos.json";
import invoicesSeed from "@/data/invoices.json";
import availabilityTemplatesSeed from "@/data/availability-templates.json";
import availabilityBlockoffsSeed from "@/data/availability-blockoffs.json";
import privateRequestsSeed from "@/data/private-requests.json";
import referralCodesSeed from "@/data/referral-codes.json";
import referralEventsSeed from "@/data/referral-events.json";
import walkInsSeed from "@/data/walk-ins.json";
import auditLogSeed from "@/data/audit-log.json";
import notificationTemplatesSeed from "@/data/notification-templates.json";
import broadcastsSeed from "@/data/broadcasts.json";
import announcementsSeed from "@/data/announcements.json";
import featureFlagsSeed from "@/data/feature-flags.json";
import refundRequestsSeed from "@/data/refund-requests.json";
import cancellationRequestsSeed from "@/data/cancellation-requests.json";

// v2 forces a fresh seed after the multi-tenant → single-studio pivot.
const STORAGE_KEY = "admin-state:v3";
const BC_NAME = "admin-state";

export const STUDIO_TENANT_ID = "studio";

export interface AdminAuthState {
  /** Effective user — switches to the target during impersonation. */
  userId: string | null;
  /** Super-admin id when impersonating; null otherwise. */
  originatorUserId: string | null;
}

export interface AdminState {
  locations: Location[];
  adminUsers: AdminUser[];
  clients: Client[];
  clientPackages: ClientPackage[];
  instructors: Instructor[];
  sessions: Session[];
  sessionTemplates: SessionTemplate[];
  bookings: Booking[];
  products: Product[];
  promos: Promo[];
  invoices: Invoice[];
  availabilityTemplates: AvailabilityTemplate[];
  availabilityBlockoffs: AvailabilityBlockoff[];
  privateRequests: PrivateRequest[];
  referralCodes: ReferralCode[];
  referralEvents: ReferralEvent[];
  walkIns: WalkIn[];
  auditLog: AuditEntry[];
  notificationTemplates: NotificationTemplate[];
  broadcasts: Broadcast[];
  announcements: Announcement[];
  featureFlags: FeatureFlag[];
  refundRequests: RefundRequest[];
  cancellationRequests: CancellationRequest[];
  memberships: Membership[];
  policy: PolicyState;
  studio: StudioSettings;
  auth: AdminAuthState;
}

export interface StudioSettings {
  name: string;
  logoEmoji: string;
  logoUrl: string;
  coverGradient: string;
  /** Markdown waiver text */
  waiverText: string;
}

const DEFAULT_STUDIO: StudioSettings = {
  name: "Yoga Sadhana",
  logoEmoji: "🪷",
  logoUrl: "",
  coverGradient: "from-accent to-sage",
  waiverText:
    "I confirm I am medically fit to practice yoga and accept full responsibility for my participation. I will inform the instructor of any injuries or conditions before class.",
};

function seed(): AdminState {
  return {
    locations: locationsSeed as Location[],
    adminUsers: adminUsersSeed as AdminUser[],
    clients: clientsSeed as Client[],
    clientPackages: clientPackagesSeed as ClientPackage[],
    instructors: instructorsSeed as Instructor[],
    sessions: sessionsSeed as Session[],
    sessionTemplates: sessionTemplatesSeed as SessionTemplate[],
    bookings: bookingsSeed as Booking[],
    products: productsSeed as Product[],
    promos: promosSeed as Promo[],
    invoices: invoicesSeed as Invoice[],
    availabilityTemplates: availabilityTemplatesSeed as AvailabilityTemplate[],
    availabilityBlockoffs: availabilityBlockoffsSeed as AvailabilityBlockoff[],
    privateRequests: privateRequestsSeed as PrivateRequest[],
    referralCodes: referralCodesSeed as ReferralCode[],
    referralEvents: referralEventsSeed as ReferralEvent[],
    walkIns: walkInsSeed as WalkIn[],
    auditLog: auditLogSeed as AuditEntry[],
    notificationTemplates: notificationTemplatesSeed as NotificationTemplate[],
    broadcasts: broadcastsSeed as Broadcast[],
    announcements: announcementsSeed as Announcement[],
    featureFlags: featureFlagsSeed as FeatureFlag[],
    refundRequests: refundRequestsSeed as RefundRequest[],
    cancellationRequests: cancellationRequestsSeed as CancellationRequest[],
    memberships: membershipsSeed as Membership[],
    policy: { ...DEFAULT_POLICY },
    studio: { ...DEFAULT_STUDIO },
    auth: { userId: "adm-maya", originatorUserId: null },
  };
}

let cached: AdminState | null = null;
let cachedServer: AdminState | null = null;
const listeners = new Set<() => void>();
let bc: BroadcastChannel | null = null;
let initialized = false;

function load(): AdminState {
  if (typeof window === "undefined") return seed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const s = seed();
      persist(s);
      return s;
    }
    const parsed = JSON.parse(raw) as AdminState;
    // If stored state has no logged-in user, reset to seed so the app is usable.
    if (!parsed.auth?.userId) {
      const s = seed();
      persist(s);
      return s;
    }
    return parsed;
  } catch {
    const s = seed();
    persist(s);
    return s;
  }
}

function persist(s: AdminState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  bc?.postMessage("update");
}

function snapshot(): AdminState {
  if (cached) return cached;
  cached = load();
  return cached;
}

function serverSnapshot(): AdminState {
  if (!cachedServer) cachedServer = seed();
  return cachedServer;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!initialized && typeof window !== "undefined") {
    initialized = true;
    try {
      bc = new BroadcastChannel(BC_NAME);
      bc.onmessage = () => {
        cached = load();
        listeners.forEach((l) => l());
      };
    } catch {
      // BroadcastChannel not available — fall back to storage only
    }
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY) {
        cached = load();
        listeners.forEach((l) => l());
      }
    });
  }
  return () => {
    listeners.delete(fn);
  };
}

export function useAdminState<T>(select: (s: AdminState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(snapshot()),
    () => select(serverSnapshot())
  );
}

export function getAdminState(): AdminState {
  return snapshot();
}

export function setState(updater: (s: AdminState) => AdminState) {
  const next = updater(snapshot());
  cached = next;
  persist(next);
  listeners.forEach((l) => l());
}

export function resetState() {
  cached = seed();
  persist(cached);
  listeners.forEach((l) => l());
}
