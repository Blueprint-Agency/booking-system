"use client";

import { useSyncExternalStore } from "react";
import type {
  AdminUser,
  Booking,
  CreditAdjustment,
  EmailTemplate,
  Invoice,
  PrivateRequest,
  Refund,
  Session,
  SessionCancellation,
  SessionTemplate,
  WaiverSignature,
} from "@/types";

import adminUsersData from "@/data/admin-users.json";
import bookingsData from "@/data/bookings.json";
import sessionsData from "@/data/sessions.json";
import privateRequestsData from "@/data/private-requests.json";
import invoicesData from "@/data/invoices.json";
import creditAdjustmentsData from "@/data/credit-adjustments.json";
import refundsData from "@/data/refunds.json";
import waiversData from "@/data/waiver-signatures.json";
import emailTemplatesData from "@/data/email-templates.json";
import sessionCancellationsData from "@/data/session-cancellations.json";

const ADMIN_USERS = adminUsersData as AdminUser[];

export type AdminState = {
  adminId: string | null;                 // currently signed-in admin
  sessions: Session[];
  bookings: Booking[];
  privateRequests: PrivateRequest[];
  invoices: Invoice[];
  creditAdjustments: CreditAdjustment[];
  refunds: Refund[];
  waivers: WaiverSignature[];
  emailTemplates: EmailTemplate[];
  sessionCancellations: SessionCancellation[];
};

const STORAGE_KEY = "admin-mock-state:v1";

function freshState(): AdminState {
  return {
    adminId: null,
    sessions: sessionsData as Session[],
    bookings: bookingsData as Booking[],
    privateRequests: privateRequestsData as PrivateRequest[],
    invoices: invoicesData as Invoice[],
    creditAdjustments: creditAdjustmentsData as CreditAdjustment[],
    refunds: refundsData as Refund[],
    waivers: waiversData as WaiverSignature[],
    emailTemplates: emailTemplatesData as EmailTemplate[],
    sessionCancellations: sessionCancellationsData as SessionCancellation[],
  };
}

const listeners = new Set<() => void>();
let cached: AdminState | null = null;

function readFromStorage(): AdminState {
  if (typeof window === "undefined") return freshState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as Partial<AdminState>;
    const base = freshState();
    return { ...base, ...parsed };
  } catch {
    return freshState();
  }
}

function writeToStorage(state: AdminState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getState(): AdminState {
  if (cached === null) cached = readFromStorage();
  return cached;
}

function setState(next: AdminState) {
  cached = next;
  writeToStorage(next);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cached = readFromStorage();
      listener();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

const SSR_SNAPSHOT = freshState();

export function useAdminState(): AdminState {
  return useSyncExternalStore(subscribe, getState, () => SSR_SNAPSHOT);
}

// --- Mutators ---

export function signInAdmin(email: string): AdminUser | null {
  const found = ADMIN_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!found) return null;
  setState({ ...getState(), adminId: found.id });
  return found;
}

export function signOutAdmin() {
  setState({ ...getState(), adminId: null });
}

export function getCurrentAdmin(state: AdminState): AdminUser | null {
  if (!state.adminId) return null;
  return ADMIN_USERS.find((u) => u.id === state.adminId) ?? null;
}

export function resetAdminState() {
  cached = freshState();
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
  listeners.forEach((l) => l());
}

// Re-export seeded admin users list for login hints etc.
export function listSeededAdmins(): AdminUser[] {
  return ADMIN_USERS;
}

// =====================================================
// --- Phase 2: Core Ops mutators ---------------------
// =====================================================

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- Schedule ----

export function cancelSession(sessionId: string, reason: string): {
  creditsRefunded: number;
  clientsAffected: string[];
} {
  const state = getState();
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session || session.status === "cancelled") {
    return { creditsRefunded: 0, clientsAffected: [] };
  }
  const affectedBookings = state.bookings.filter(
    (b) => b.sessionId === sessionId && b.status === "confirmed",
  );
  const clientsAffected = affectedBookings.map((b) => b.clientId);

  const adjustments: CreditAdjustment[] = affectedBookings.map((b) => ({
    id: nextId("ca"),
    clientId: b.clientId,
    packageId: b.packageId,
    delta: 1,
    reason: `session cancelled: ${reason}`,
    adminId: state.adminId ?? "system",
    createdAt: nowIso(),
  }));

  const cancellation: SessionCancellation = {
    id: nextId("sc"),
    sessionId,
    reason,
    adminId: state.adminId ?? "system",
    creditsRefunded: affectedBookings.length,
    clientsAffected,
    createdAt: nowIso(),
  };

  setState({
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === sessionId ? { ...s, status: "cancelled", bookedCount: 0 } : s,
    ),
    bookings: state.bookings.map((b) =>
      b.sessionId === sessionId && b.status === "confirmed"
        ? { ...b, status: "cancelled" }
        : b,
    ),
    creditAdjustments: [...state.creditAdjustments, ...adjustments],
    sessionCancellations: [...state.sessionCancellations, cancellation],
  });
  return { creditsRefunded: affectedBookings.length, clientsAffected };
}

export function createSessionInstances(instances: Omit<Session, "id">[]): Session[] {
  const state = getState();
  const withIds: Session[] = instances.map((i) => ({ ...i, id: nextId("sess") }));
  setState({ ...state, sessions: [...state.sessions, ...withIds] });
  return withIds;
}

export function createWorkshop(input: {
  tenantId: string;
  locationId: string;
  name: string;
  instructorId: string;
  date: string;
  time: string;
  duration: number;
  capacity: number;
  price: number;
  level: Session["level"];
  category?: string;
}): Session {
  const state = getState();
  const workshop: Session = {
    id: nextId("sess"),
    tenantId: input.tenantId,
    locationId: input.locationId,
    templateId: null,
    name: input.name,
    category: input.category ?? "Workshop",
    level: input.level,
    type: "workshop",
    instructorId: input.instructorId,
    capacity: input.capacity,
    bookedCount: 0,
    waitlistCount: 0,
    date: input.date,
    time: input.time,
    duration: input.duration,
    price: input.price,
    status: "scheduled",
    recurrence: null,
  };
  setState({ ...state, sessions: [...state.sessions, workshop] });
  return workshop;
}

export function swapSessionInstructor(sessionId: string, instructorId: string): void {
  const state = getState();
  setState({
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === sessionId ? { ...s, instructorId } : s,
    ),
  });
}

// ---- Session Detail / Booking ----

export function manualBook(sessionId: string, clientId: string): Booking | null {
  const state = getState();
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const exists = state.bookings.find(
    (b) => b.sessionId === sessionId && b.clientId === clientId && b.status === "confirmed",
  );
  if (exists) return exists;
  const atCapacity = session.bookedCount >= session.capacity;
  const booking: Booking = {
    id: nextId("bk"),
    clientId,
    sessionId,
    status: atCapacity ? "waitlisted" : "confirmed",
    checkInStatus: "pending",
    packageId: null,
    rating: null,
    createdAt: nowIso(),
  };
  setState({
    ...state,
    bookings: [...state.bookings, booking],
    sessions: state.sessions.map((s) =>
      s.id === sessionId
        ? atCapacity
          ? { ...s, waitlistCount: s.waitlistCount + 1 }
          : { ...s, bookedCount: s.bookedCount + 1 }
        : s,
    ),
  });
  return booking;
}

export function cancelBooking(bookingId: string): void {
  const state = getState();
  const booking = state.bookings.find((b) => b.id === bookingId);
  if (!booking || booking.status === "cancelled") return;
  setState({
    ...state,
    bookings: state.bookings.map((b) =>
      b.id === bookingId ? { ...b, status: "cancelled" } : b,
    ),
    sessions: state.sessions.map((s) =>
      s.id === booking.sessionId
        ? { ...s, bookedCount: Math.max(0, s.bookedCount - 1) }
        : s,
    ),
  });
}

export function markNoShow(bookingId: string): void {
  const state = getState();
  setState({
    ...state,
    bookings: state.bookings.map((b) =>
      b.id === bookingId ? { ...b, checkInStatus: "no-show" } : b,
    ),
  });
}

// ---- Check-in ----

export function checkInByBookingId(bookingId: string): {
  booking: Booking;
  session: Session;
} | null {
  const state = getState();
  const booking = state.bookings.find((b) => b.id === bookingId);
  if (!booking || booking.status !== "confirmed") return null;
  const session = state.sessions.find((s) => s.id === booking.sessionId);
  if (!session) return null;
  setState({
    ...state,
    bookings: state.bookings.map((b) =>
      b.id === bookingId ? { ...b, checkInStatus: "attended" } : b,
    ),
  });
  return { booking: { ...booking, checkInStatus: "attended" }, session };
}

// ---- Private Requests ----

export function approveRequest(
  requestId: string,
  scheduled: { date: string; time: string },
): void {
  const state = getState();
  setState({
    ...state,
    privateRequests: state.privateRequests.map((r) =>
      r.id === requestId
        ? {
            ...r,
            status: "approved",
            resolution: {
              resolvedAt: nowIso(),
              resolvedBy: state.adminId ?? "system",
              scheduledDate: scheduled.date,
              scheduledTime: scheduled.time,
            },
          }
        : r,
    ),
  });
}

export function declineRequest(requestId: string, reason: string): void {
  const state = getState();
  setState({
    ...state,
    privateRequests: state.privateRequests.map((r) =>
      r.id === requestId
        ? {
            ...r,
            status: "declined",
            resolution: {
              resolvedAt: nowIso(),
              resolvedBy: state.adminId ?? "system",
              declineReason: reason,
            },
          }
        : r,
    ),
  });
}

export type { SessionTemplate };
