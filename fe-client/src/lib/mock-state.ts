"use client";

import { useSyncExternalStore } from "react";

export type MockUser = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  gender?: string;
};

export type MockPackage = {
  id: string;               // package catalogue id (b-10, u-3, p1-10, ...)
  name: string;
  kind: "class-credit" | "class-unlimited" | "pt1on1" | "pt2on1";
  credits: number;          // remaining credits; unlimited uses 0 but isActive by expiry
  totalCredits: number;
  purchasedAt: string;      // ISO date
  expiresAt: string;        // ISO date
  price: number;
};

export type MockBooking = {
  id: string;
  sessionId: string;
  type: "class" | "workshop" | "private";
  bookedAt: string;
  meta?: {
    name: string;
    instructorId?: string;
    instructorName?: string;
    locationId?: string;
    locationName?: string;
    startsAt: string; // ISO date-time
    duration: number; // minutes
  };
};

export type MockInvoice = {
  id: string;            // e.g. INV-20260419-0001
  issuedAt: string;      // ISO
  itemName: string;
  itemKind: "package" | "workshop";
  subtotal: number;
  tax: number;
  total: number;
  referenceId?: string;  // package catalogue id or session id
};

type State = {
  user: MockUser | null;
  packages: MockPackage[];
  bookings: MockBooking[];
  invoices: MockInvoice[];
  attendedBookings: string[];
  cancelledBookings: string[];
  confirmedPrivateBookings: string[];
};

const STORAGE_KEY = "mock-state:v1";

const listeners = new Set<() => void>();
let cached: State | null = null;

function emptyState(): State {
  return { user: null, packages: [], bookings: [], invoices: [], attendedBookings: [], cancelledBookings: [], confirmedPrivateBookings: [] };
}

function readFromStorage(): State {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as State;
    return {
      user: parsed.user ?? null,
      packages: parsed.packages ?? [],
      bookings: parsed.bookings ?? [],
      invoices: parsed.invoices ?? [],
      attendedBookings: parsed.attendedBookings ?? [],
      cancelledBookings: parsed.cancelledBookings ?? [],
      confirmedPrivateBookings: parsed.confirmedPrivateBookings ?? [],
    };
  } catch {
    return emptyState();
  }
}

function writeToStorage(state: State) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getState(): State {
  if (cached === null) cached = readFromStorage();
  return cached;
}

function setState(next: State) {
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

const EMPTY_SNAPSHOT: State = { user: null, packages: [], bookings: [], invoices: [], attendedBookings: [], cancelledBookings: [], confirmedPrivateBookings: [] };

export function useMockState(): State {
  return useSyncExternalStore(
    subscribe,
    () => getState(),
    () => EMPTY_SNAPSHOT
  );
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function signUp(user: MockUser) {
  // New account starts with a clean slate
  setState({ user, packages: [], bookings: [], invoices: [], attendedBookings: [], cancelledBookings: [], confirmedPrivateBookings: [] });
}

export function cancelBooking(bookingId: string) {
  const s = getState();
  if (s.cancelledBookings.includes(bookingId)) return;
  setState({ ...s, cancelledBookings: [...s.cancelledBookings, bookingId] });
}

export function signIn(email?: string) {
  const s = getState();
  if (s.user) return; // already signed in
  // Fresh session: clear any lingering account-related mock data
  setState({
    user: {
      firstName: "Guest",
      lastName: "",
      email: email || "guest@example.com",
    },
    packages: [],
    bookings: [],
    invoices: [],
    attendedBookings: [],
    cancelledBookings: [],
    confirmedPrivateBookings: [],
  });
}

export function signOut() {
  // Clear all account-related mock data on logout
  setState({ user: null, packages: [], bookings: [], invoices: [], attendedBookings: [], cancelledBookings: [], confirmedPrivateBookings: [] });
}

export function confirmPrivateBooking(bookingId: string) {
  const s = getState();
  if (s.confirmedPrivateBookings.includes(bookingId)) return;
  setState({ ...s, confirmedPrivateBookings: [...s.confirmedPrivateBookings, bookingId] });
}

export function markAttended(bookingId: string) {
  const s = getState();
  if (s.attendedBookings.includes(bookingId)) return;
  setState({ ...s, attendedBookings: [...s.attendedBookings, bookingId] });
}

export function isLoggedIn(): boolean {
  return getState().user !== null;
}

export function addPackage(pkg: MockPackage) {
  const s = getState();
  setState({ ...s, packages: [...s.packages, pkg] });
}

export function recordInvoice(invoice: MockInvoice) {
  const s = getState();
  setState({ ...s, invoices: [...s.invoices, invoice] });
}

function nextInvoiceId(existing: MockInvoice[]): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const seq = String(existing.length + 1).padStart(4, "0");
  return `INV-${stamp}-${seq}`;
}

export function issueInvoice(args: {
  itemName: string;
  itemKind: "package" | "workshop";
  subtotal: number;
  referenceId?: string;
  taxRate?: number;
}): MockInvoice {
  const s = getState();
  const taxRate = args.taxRate ?? 0.09;
  const tax = Math.round(args.subtotal * taxRate * 100) / 100;
  const invoice: MockInvoice = {
    id: nextInvoiceId(s.invoices),
    issuedAt: new Date().toISOString(),
    itemName: args.itemName,
    itemKind: args.itemKind,
    subtotal: args.subtotal,
    tax,
    total: Math.round((args.subtotal + tax) * 100) / 100,
    referenceId: args.referenceId,
  };
  setState({ ...s, invoices: [...s.invoices, invoice] });
  return invoice;
}

export function recordBooking(
  booking: MockBooking,
  opts: { decrementCredits?: boolean; fromPackageId?: string } = {}
) {
  const s = getState();
  if (s.bookings.some((b) => b.id === booking.id)) return;
  let packages = s.packages;
  if (opts.decrementCredits) {
    let idx = -1;
    if (opts.fromPackageId) {
      idx = packages.findIndex(
        (p) =>
          p.id === opts.fromPackageId &&
          p.kind === "class-credit" &&
          p.credits > 0 &&
          !isExpired(p)
      );
    }
    if (idx === -1) {
      idx = packages.findIndex(
        (p) => p.kind === "class-credit" && p.credits > 0 && !isExpired(p)
      );
    }
    if (idx !== -1) {
      packages = packages.map((p, i) =>
        i === idx ? { ...p, credits: p.credits - 1 } : p
      );
    }
  }
  setState({ ...s, packages, bookings: [...s.bookings, booking] });
}

export function decrementPrivateCredit(): boolean {
  const s = getState();
  const active = s.packages
    .map((p, i) => ({ p, i }))
    .filter(
      ({ p }) =>
        (p.kind === "pt1on1" || p.kind === "pt2on1") &&
        p.credits > 0 &&
        !isExpired(p),
    );
  if (active.length === 0) return false;
  // Prefer pt1on1 first, then pt2on1
  active.sort((a, b) => (a.p.kind === b.p.kind ? 0 : a.p.kind === "pt1on1" ? -1 : 1));
  const target = active[0];
  const packages = s.packages.map((p, i) =>
    i === target.i ? { ...p, credits: p.credits - 1 } : p,
  );
  setState({ ...s, packages });
  return true;
}

export function isExpired(p: MockPackage): boolean {
  return new Date(p.expiresAt).getTime() < Date.now();
}

export function getActiveClassCredits(state: State): number {
  return state.packages
    .filter((p) => p.kind === "class-credit" && !isExpired(p))
    .reduce((sum, p) => sum + p.credits, 0);
}

export function hasActiveUnlimited(state: State): boolean {
  return state.packages.some((p) => p.kind === "class-unlimited" && !isExpired(p));
}

export function getActiveSessionCredits(state: State): number {
  return state.packages
    .filter((p) => (p.kind === "pt1on1" || p.kind === "pt2on1") && !isExpired(p))
    .reduce((sum, p) => sum + p.credits, 0);
}

export function hasActiveBundle(state: State): boolean {
  return state.packages.some(
    (p) => p.kind === "class-credit" && p.credits > 0 && !isExpired(p)
  );
}

export function getPurchaseBlock(
  state: State,
  catalogueId: string
): { blocked: boolean; reason?: string } {
  const cat = PACKAGE_CATALOGUE[catalogueId];
  if (!cat) return { blocked: false };
  if (cat.kind === "class-credit" && hasActiveUnlimited(state)) {
    return {
      blocked: true,
      reason:
        "You already have an active Unlimited pass. Bundles and Unlimited can't be held at the same time.",
    };
  }
  if (cat.kind === "class-unlimited" && hasActiveBundle(state)) {
    return {
      blocked: true,
      reason:
        "You still have an active Credit Bundle. Bundles and Unlimited can't be held at the same time.",
    };
  }
  return { blocked: false };
}

export function canBookClass(state: State): boolean {
  return hasActiveUnlimited(state) || getActiveClassCredits(state) > 0;
}

// ── Catalogue helpers ────────────────────────────────────────────────────────

export type CataloguePackage = {
  id: string;
  name: string;
  kind: MockPackage["kind"];
  credits: number;
  validDays: number;
  price: number;
};

export const PACKAGE_CATALOGUE: Record<string, CataloguePackage> = {
  "b-otp":    { id: "b-otp",    name: "One-time Pass",       kind: "class-credit",     credits: 1,   validDays: 1,   price: 40 },
  "b-10":     { id: "b-10",     name: "Bundle of 10",        kind: "class-credit",     credits: 10,  validDays: 90,  price: 300 },
  "b-20":     { id: "b-20",     name: "Bundle of 20",        kind: "class-credit",     credits: 20,  validDays: 180, price: 550 },
  "b-30":     { id: "b-30",     name: "Bundle of 30",        kind: "class-credit",     credits: 30,  validDays: 365, price: 750 },
  "b-50":     { id: "b-50",     name: "Bundle of 50",        kind: "class-credit",     credits: 50,  validDays: 365, price: 1100 },
  "b-100":    { id: "b-100",    name: "Bundle of 100",       kind: "class-credit",     credits: 100, validDays: 365, price: 2000 },
  "u-3":      { id: "u-3",      name: "3-Month Unlimited",   kind: "class-unlimited",  credits: 0,   validDays: 90,  price: 600 },
  "u-6":      { id: "u-6",      name: "6-Month Unlimited",   kind: "class-unlimited",  credits: 0,   validDays: 180, price: 1000 },
  "u-12":     { id: "u-12",     name: "12-Month Unlimited",  kind: "class-unlimited",  credits: 0,   validDays: 365, price: 1700 },
  "p1-10":    { id: "p1-10",    name: "VIP 1-on-1 · 10",     kind: "pt1on1",           credits: 20,  validDays: 365, price: 1600 },
  "p1-20":    { id: "p1-20",    name: "VIP 1-on-1 · 20",     kind: "pt1on1",           credits: 40,  validDays: 365, price: 3000 },
  "p1-30":    { id: "p1-30",    name: "VIP 1-on-1 · 30",     kind: "pt1on1",           credits: 60,  validDays: 365, price: 4200 },
  "p1-40":    { id: "p1-40",    name: "VIP 1-on-1 · 40",     kind: "pt1on1",           credits: 80,  validDays: 365, price: 5200 },
  "p1-50":    { id: "p1-50",    name: "VIP 1-on-1 · 50",     kind: "pt1on1",           credits: 100, validDays: 365, price: 6000 },
  "p1-100":   { id: "p1-100",   name: "VIP 1-on-1 · 100",    kind: "pt1on1",           credits: 200, validDays: 365, price: 11000 },
  "p2-10":    { id: "p2-10",    name: "VIP 2-on-1 · 10",     kind: "pt2on1",           credits: 10,  validDays: 365, price: 2000 },
  "p2-20":    { id: "p2-20",    name: "VIP 2-on-1 · 20",     kind: "pt2on1",           credits: 20,  validDays: 365, price: 3600 },
  "p2-30":    { id: "p2-30",    name: "VIP 2-on-1 · 30",     kind: "pt2on1",           credits: 30,  validDays: 365, price: 4800 },
  "p2-50":    { id: "p2-50",    name: "VIP 2-on-1 · 50",     kind: "pt2on1",           credits: 50,  validDays: 365, price: 7500 },
};

export function purchasePackage(catalogueId: string): MockPackage | null {
  const cat = PACKAGE_CATALOGUE[catalogueId];
  if (!cat) return null;
  const now = new Date();
  const expires = new Date(now.getTime() + cat.validDays * 24 * 60 * 60 * 1000);
  const pkg: MockPackage = {
    id: `${cat.id}-${Date.now()}`,
    name: cat.name,
    kind: cat.kind,
    credits: cat.credits,
    totalCredits: cat.credits,
    purchasedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    price: cat.price,
  };
  addPackage(pkg);
  return pkg;
}
