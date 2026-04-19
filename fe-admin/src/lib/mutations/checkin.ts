"use client";

import { setState, getAdminState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { Booking } from "@/types";

const NO_SHOW_THRESHOLD = 3;

export function recordCheckIn(bookingId: string): Booking | null {
  let result: Booking | null = null;
  setState((s) => {
    const b = s.bookings.find((x) => x.id === bookingId);
    if (!b) return s;
    const next: Booking = {
      ...b,
      checkInStatus: "attended",
      checkedInAt: new Date().toISOString(),
    };
    result = next;
    return { ...s, bookings: s.bookings.map((x) => (x.id === b.id ? next : x)) };
  });
  return result;
}

export function recordNoShow(bookingId: string): Booking | null {
  let next: Booking | null = null;
  let prevCount = 0;
  let nextCount = 0;
  let clientId: string | null = null;
  setState((s) => {
    const b = s.bookings.find((x) => x.id === bookingId);
    if (!b) return s;
    clientId = b.clientId;
    const updated: Booking = { ...b, checkInStatus: "no-show" };
    next = updated;
    const clients = s.clients.map((c) => {
      if (c.id !== b.clientId) return c;
      prevCount = c.noShowCount;
      nextCount = c.noShowCount + 1;
      return { ...c, noShowCount: nextCount };
    });
    return {
      ...s,
      bookings: s.bookings.map((x) => (x.id === b.id ? updated : x)),
      clients,
    };
  });
  if (next && clientId && prevCount < NO_SHOW_THRESHOLD && nextCount >= NO_SHOW_THRESHOLD) {
    const after = getAdminState().clients.find((c) => c.id === clientId);
    appendAuditEntry({
      action: "client.update",
      entityType: "Client",
      entityId: clientId,
      before: { noShowCount: prevCount },
      after: { noShowCount: nextCount },
      note: `No-show threshold reached (${nextCount}). Auto-flag.`,
    });
    void after;
  }
  return next;
}

export function findBookingByQr(payload: string) {
  // Accept either a raw booking id, or a JSON payload like {"bookingId":"..."}
  const trimmed = payload.trim();
  if (!trimmed) return null;
  let id = trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { bookingId?: string };
    if (parsed.bookingId) id = parsed.bookingId;
  } catch {
    // not JSON, use as-is
  }
  return getAdminState().bookings.find((b) => b.id === id) ?? null;
}
