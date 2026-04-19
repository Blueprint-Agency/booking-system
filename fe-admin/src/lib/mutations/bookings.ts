"use client";

import { setState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { Booking } from "@/types";

export interface CancelBookingAdminInput {
  bookingId: string;
  refund: boolean;
  reason: string;
}

export function cancelBookingAdmin(input: CancelBookingAdminInput): Booking {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Cancel reason required");

  let before: Booking | null = null;
  let after: Booking | null = null;

  setState((s) => {
    const booking = s.bookings.find((b) => b.id === input.bookingId);
    if (!booking) return s;
    if (booking.status === "cancelled") return s;
    before = booking;
    after = {
      ...booking,
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      cancelReason: reason,
      refunded: input.refund,
    };

    const bookings = s.bookings.map((b) => (b.id === booking.id ? after! : b));

    let clientPackages = s.clientPackages;
    if (input.refund && booking.packageId) {
      clientPackages = clientPackages.map((p) =>
        p.id === booking.packageId
          ? { ...p, sessionsRemaining: Math.min(p.sessionsTotal, p.sessionsRemaining + 1) }
          : p,
      );
    }

    const sessions = s.sessions.map((sess) =>
      sess.id === booking.sessionId
        ? { ...sess, bookedCount: Math.max(0, sess.bookedCount - 1) }
        : sess,
    );

    return { ...s, bookings, clientPackages, sessions };
  });

  if (!before || !after) throw new Error("Booking not found or already cancelled");
  appendAuditEntry({
    action: "booking.cancelAdmin",
    entityType: "Booking",
    entityId: input.bookingId,
    before,
    after,
    note: reason,
  });
  return after;
}
