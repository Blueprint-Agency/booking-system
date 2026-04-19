"use client";

import { useSyncExternalStore } from "react";
import type {
  AdminUser,
  Booking,
  Client,
  ClientPackage,
  CreditAdjustment,
  EmailTemplate,
  Instructor,
  Invoice,
  Location,
  Membership,
  PrivateRequest,
  Product,
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
import clientsData from "@/data/clients.json";
import productsData from "@/data/products.json";
import clientPackagesData from "@/data/client-packages.json";
import membershipsData from "@/data/memberships.json";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";
import sessionTemplatesData from "@/data/session-templates.json";

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
  // Phase 3:
  clients: Client[];
  products: Product[];
  clientPackages: ClientPackage[];
  memberships: Membership[];
  instructors: Instructor[];
  locations: Location[];
  sessionTemplates: SessionTemplate[];
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
    clients: clientsData as Client[],
    products: productsData as Product[],
    clientPackages: clientPackagesData as ClientPackage[],
    memberships: membershipsData as Membership[],
    instructors: instructorsData as Instructor[],
    locations: locationsData as Location[],
    sessionTemplates: sessionTemplatesData as SessionTemplate[],
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

// =====================================================
// --- Phase 3: Clients & Catalog mutators ------------
// =====================================================

// ---- Clients ----

export function upsertClient(input: Partial<Client> & { id?: string }): Client {
  const state = getState();
  const now = nowIso();
  if (input.id) {
    const existing = state.clients.find((c) => c.id === input.id);
    if (!existing) throw new Error(`Client ${input.id} not found`);
    const merged: Client = { ...existing, ...input } as Client;
    setState({ ...state, clients: state.clients.map((c) => (c.id === input.id ? merged : c)) });
    return merged;
  }
  const created: Client = {
    id: nextId("cli"),
    tenantId: input.tenantId ?? state.clients[0]?.tenantId ?? "",
    firstName: input.firstName ?? "",
    lastName: input.lastName ?? "",
    email: input.email ?? "",
    phone: input.phone ?? "",
    registeredAt: now,
    activityStatus: "active",
    noShowCount: 0,
    totalSessions: 0,
    tags: input.tags ?? [],
    waiverSigned: false,
    waiverSignedAt: null,
    waiverVersion: null,
    referralCode: `REF-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    referredBy: input.referredBy ?? null,
    notes: input.notes,
  };
  setState({ ...state, clients: [...state.clients, created] });
  return created;
}

export function adjustClientCredits(input: {
  clientId: string;
  packageId: string | null;
  delta: number;
  reason: string;
}): CreditAdjustment {
  const state = getState();
  const adj: CreditAdjustment = {
    id: nextId("ca"),
    clientId: input.clientId,
    packageId: input.packageId,
    delta: input.delta,
    reason: input.reason,
    adminId: state.adminId ?? "system",
    createdAt: nowIso(),
  };
  const nextPackages = input.packageId
    ? state.clientPackages.map((p) =>
        p.id === input.packageId
          ? {
              ...p,
              creditsRemaining: Math.max(0, p.creditsRemaining + input.delta),
              status:
                p.creditsRemaining + input.delta <= 0 ? ("depleted" as const) : p.status,
            }
          : p,
      )
    : state.clientPackages;
  setState({
    ...state,
    creditAdjustments: [...state.creditAdjustments, adj],
    clientPackages: nextPackages,
  });
  return adj;
}

// ---- Products (packages / workshops / memberships / private packs) ----

export function upsertProduct(input: Partial<Product> & { id?: string }): Product {
  const state = getState();
  if (input.id) {
    const existing = state.products.find((p) => p.id === input.id);
    if (!existing) throw new Error(`Product ${input.id} not found`);
    const merged: Product = { ...existing, ...input } as Product;
    setState({ ...state, products: state.products.map((p) => (p.id === input.id ? merged : p)) });
    return merged;
  }
  const created: Product = {
    id: nextId("prod"),
    tenantId: input.tenantId ?? state.products[0]?.tenantId ?? "",
    name: input.name ?? "Untitled",
    type: input.type ?? "package",
    creditType: input.creditType ?? "class",
    price: input.price ?? 0,
    sessionCount: input.sessionCount ?? null,
    expiryDays: input.expiryDays ?? null,
    sessionsPerMonth: input.sessionsPerMonth ?? null,
    description: input.description ?? "",
    active: input.active ?? true,
  };
  setState({ ...state, products: [...state.products, created] });
  return created;
}

export function toggleProductActive(productId: string): void {
  const state = getState();
  setState({
    ...state,
    products: state.products.map((p) =>
      p.id === productId ? { ...p, active: !p.active } : p,
    ),
  });
}

// ---- Instructors ----

export function upsertInstructor(input: Partial<Instructor> & { id?: string }): Instructor {
  const state = getState();
  if (input.id) {
    const existing = state.instructors.find((i) => i.id === input.id);
    if (!existing) throw new Error(`Instructor ${input.id} not found`);
    const merged: Instructor = { ...existing, ...input } as Instructor;
    setState({ ...state, instructors: state.instructors.map((i) => (i.id === input.id ? merged : i)) });
    return merged;
  }
  const created: Instructor = {
    id: nextId("inst"),
    tenantId: input.tenantId ?? state.instructors[0]?.tenantId ?? "",
    name: input.name ?? "New Instructor",
    bio: input.bio ?? "",
    photo: input.photo ?? "",
    specialties: input.specialties ?? [],
    availability: input.availability ?? [],
  };
  setState({ ...state, instructors: [...state.instructors, created] });
  return created;
}

// ---- Locations ----

export function upsertLocation(input: Partial<Location> & { id?: string }): Location {
  const state = getState();
  if (input.id) {
    const existing = state.locations.find((l) => l.id === input.id);
    if (!existing) throw new Error(`Location ${input.id} not found`);
    const merged: Location = { ...existing, ...input } as Location;
    setState({ ...state, locations: state.locations.map((l) => (l.id === input.id ? merged : l)) });
    return merged;
  }
  const created: Location = {
    id: nextId("loc"),
    tenantId: input.tenantId ?? state.locations[0]?.tenantId ?? "",
    name: input.name ?? "New Location",
    shortName: input.shortName ?? "New",
    address: input.address ?? "",
    area: input.area ?? "",
    rooms: input.rooms,
    amenities: input.amenities ?? [],
    mapUrl: input.mapUrl,
  };
  setState({ ...state, locations: [...state.locations, created] });
  return created;
}

// ---- Class templates ----

export function upsertSessionTemplate(
  input: Partial<SessionTemplate> & { id?: string },
): SessionTemplate {
  const state = getState();
  if (input.id) {
    const existing = state.sessionTemplates.find((t) => t.id === input.id);
    if (!existing) throw new Error(`Template ${input.id} not found`);
    const merged: SessionTemplate = { ...existing, ...input } as SessionTemplate;
    setState({
      ...state,
      sessionTemplates: state.sessionTemplates.map((t) => (t.id === input.id ? merged : t)),
    });
    return merged;
  }
  const created: SessionTemplate = {
    id: nextId("tmpl"),
    tenantId: input.tenantId ?? state.sessionTemplates[0]?.tenantId ?? "",
    locationId: input.locationId ?? "",
    name: input.name ?? "New Template",
    category: input.category ?? "Vinyasa",
    level: input.level ?? "all",
    instructorId: input.instructorId ?? "",
    dayOfWeek: input.dayOfWeek ?? 1,
    time: input.time ?? "07:00",
    duration: input.duration ?? 60,
    capacity: input.capacity ?? 15,
    creditCost: input.creditCost ?? 1,
    active: input.active ?? true,
  };
  setState({ ...state, sessionTemplates: [...state.sessionTemplates, created] });
  return created;
}

export function toggleTemplateActive(id: string): void {
  const state = getState();
  setState({
    ...state,
    sessionTemplates: state.sessionTemplates.map((t) =>
      t.id === id ? { ...t, active: !t.active } : t,
    ),
  });
}
