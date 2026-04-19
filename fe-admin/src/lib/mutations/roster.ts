"use client";

import { setState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { Booking, Client } from "@/types";

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface AddToRosterInput {
  sessionId: string;
  clientId: string;
  packageId: string | null;
  source: "walk-in" | "admin";
  note?: string;
}

export function addToRoster(input: AddToRosterInput): Booking {
  let beforeRef: Booking | null = null;
  let afterRef: Booking | null = null;

  setState((s) => {
    const session = s.sessions.find((x) => x.id === input.sessionId);
    if (!session) return s;

    const booking: Booking = {
      id: newId("bkg"),
      tenantId: session.tenantId,
      clientId: input.clientId,
      sessionId: input.sessionId,
      status: "confirmed",
      checkInStatus: "pending",
      packageId: input.packageId,
      rating: null,
      createdAt: new Date().toISOString(),
      source: input.source,
    };
    afterRef = booking;

    let clientPackages = s.clientPackages;
    if (input.packageId) {
      clientPackages = clientPackages.map((p) =>
        p.id === input.packageId
          ? { ...p, sessionsRemaining: Math.max(0, p.sessionsRemaining - 1) }
          : p,
      );
    }

    const sessions = s.sessions.map((x) =>
      x.id === session.id ? { ...x, bookedCount: x.bookedCount + 1 } : x,
    );

    return {
      ...s,
      bookings: [booking, ...s.bookings],
      clientPackages,
      sessions,
    };
  });

  const after = afterRef as Booking | null;
  if (!after) throw new Error("Session not found");
  appendAuditEntry({
    action: "session.update",
    entityType: "Booking",
    entityId: after.id,
    before: beforeRef,
    after,
    note: input.note ?? `Added ${input.source} to roster`,
  });
  return after;
}

export interface MarkAttendanceInput {
  bookingId: string;
  status: Booking["checkInStatus"];
  note?: string;
}

export function markAttendance(input: MarkAttendanceInput): Booking {
  let beforeRef: Booking | null = null;
  let afterRef: Booking | null = null;

  setState((s) => {
    const b = s.bookings.find((x) => x.id === input.bookingId);
    if (!b) return s;
    beforeRef = b;
    const next: Booking = {
      ...b,
      checkInStatus: input.status,
      checkedInAt: input.status === "attended" ? new Date().toISOString() : b.checkedInAt,
    };
    afterRef = next;
    return { ...s, bookings: s.bookings.map((x) => (x.id === b.id ? next : x)) };
  });

  const before = beforeRef as Booking | null;
  const after = afterRef as Booking | null;
  if (!before || !after) throw new Error("Booking not found");
  appendAuditEntry({
    action: "session.update",
    entityType: "Booking",
    entityId: input.bookingId,
    before,
    after,
    note: input.note ?? `Attendance: ${input.status}`,
  });
  return after;
}

export interface CreateWalkInClientInput {
  tenantId: string;
  name: string;
  phone: string;
  email?: string;
  primaryLocationId: string | null;
}

export function createWalkInClient(input: CreateWalkInClientInput): Client {
  const client: Client = {
    id: newId("cli"),
    tenantId: input.tenantId,
    name: input.name.trim(),
    email: input.email?.trim() ?? "",
    phone: input.phone.trim(),
    registeredAt: new Date().toISOString(),
    activityStatus: "active",
    noShowCount: 0,
    totalSessions: 0,
    tags: ["walk-in"],
    waiverSigned: false,
    waiverSignedAt: null,
    waiverVersion: null,
    lastVisit: null,
    internalNote: null,
    primaryLocationId: input.primaryLocationId,
  };
  setState((s) => ({ ...s, clients: [client, ...s.clients] }));
  appendAuditEntry({
    action: "client.create",
    entityType: "Client",
    entityId: client.id,
    before: null,
    after: client,
    note: "Created via walk-in",
  });
  return client;
}
