// Wire shape for the admin PT-request triage queue.
// Mirrors be/src/routes/portal/admin/pt-sessions.ts `serialize()`.

export type PtStatus =
  | "pending"
  | "scheduled"
  | "cancelled_before_scheduled"
  | "cancelled_after_scheduled"
  | "attended";
export type PtRefundOutcome = "session_returned" | "forfeited" | "n_a" | null;

/**
 * A slot the member proposed. Members propose a start time only, so `end_time`
 * is null on new requests; older ones carry the end they were made with.
 * Times are Postgres `time`, HH:MM:SS.
 */
export interface PtProposedSlot {
  proposed_date: string;
  start_time: string;
  end_time: string | null;
}

const hhmm = (t: string) => t.slice(0, 5);

/** "09:00", or "09:00–10:00" on an older request that proposed an end. */
export function ptSlotTime(s: PtProposedSlot): string {
  return s.end_time ? `${hhmm(s.start_time)}–${hhmm(s.end_time)}` : hhmm(s.start_time);
}

/** Start as HH:MM, for prefilling a scheduling form. */
export function ptSlotStart(s: PtProposedSlot): string {
  return hhmm(s.start_time);
}

/**
 * End as HH:MM, for prefilling a scheduling form: the proposed end where there
 * is one, else an hour after the start for staff to adjust.
 */
export function ptSlotEnd(s: PtProposedSlot): string {
  if (s.end_time) return hhmm(s.end_time);
  const [h, m] = s.start_time.split(":").map(Number);
  const end = Math.min(h * 60 + m + 60, 23 * 60 + 59);
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

/** The preferred class type's name, or "Any class type". */
export function ptClassTypeName(classType: { name: string } | null): string {
  return classType?.name ?? "Any class type";
}

export interface ApiPtRequest {
  id: string;
  status: PtStatus;
  session_type: "1on1" | "2on1";
  message: string | null;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  refund_outcome: PtRefundOutcome;
  client: { id: string; name: string; email: string };
  // The member's preferred class type; null when they asked for "any".
  class_type: { id: string; name: string } | null;
  location: { id: string; name: string };
  // Only present for 2on1. clientId is null when the partner isn't a member yet.
  co_client: { clientId: string | null; name: string | null; email: string | null } | null;
  // The instructor the member bought these sessions with. Null means the
  // package is open to any of them.
  bound_instructor: { id: string; name: string } | null;
  slots: PtProposedSlot[];
  session: {
    id: string;
    starts_at: string;
    ends_at: string;
    instructor_name: string | null;
    room_name: string | null;
  } | null;
}

export type PtFilter = "pending" | "scheduled" | "cancelled" | "attended" | "all";

export const PT_FILTER_LABEL: Record<PtFilter, string> = {
  pending: "Pending",
  scheduled: "Scheduled",
  cancelled: "Cancelled",
  attended: "Attended",
  all: "All",
};

export const PT_STATUS_TONE: Record<PtStatus, "accent" | "sage" | "error"> = {
  pending: "accent",
  scheduled: "sage",
  cancelled_before_scheduled: "error",
  cancelled_after_scheduled: "error",
  attended: "sage",
};

export const PT_STATUS_SHORT: Record<PtStatus, string> = {
  pending: "pending",
  scheduled: "scheduled",
  cancelled_before_scheduled: "cancelled",
  cancelled_after_scheduled: "cancelled",
  attended: "attended",
};

export const PT_STATUS_LABEL: Record<PtStatus, string> = {
  pending: "pending",
  scheduled: "scheduled",
  // A PT request holds sessions, not money — what comes back is the session, and
  // "refunded" is kept for money going back through Stripe (#275).
  cancelled_before_scheduled: "cancelled (session returned)",
  cancelled_after_scheduled: "cancelled",
  attended: "attended",
};

export function ptStatusLabel(r: ApiPtRequest): string {
  if (r.status === "cancelled_after_scheduled") {
    if (r.refund_outcome === "session_returned") return "cancelled (session returned)";
    if (r.refund_outcome === "forfeited") return "cancelled (forfeited)";
  }
  return PT_STATUS_LABEL[r.status];
}

export function ptRefundLabel(outcome: PtRefundOutcome): string | null {
  if (outcome === "session_returned") return "session returned";
  if (outcome === "forfeited") return "session forfeited";
  return null;
}

export function ptInFilter(r: ApiPtRequest, f: PtFilter): boolean {
  if (f === "all") return true;
  if (f === "cancelled") {
    return (
      r.status === "cancelled_before_scheduled" ||
      r.status === "cancelled_after_scheduled"
    );
  }
  return r.status === f;
}

export function ptPartnerDisplay(r: ApiPtRequest): string {
  if (!r.co_client) return "—";
  if (r.co_client.clientId) return r.co_client.name ?? "Existing member";
  return [r.co_client.name, r.co_client.email].filter(Boolean).join(" · ") || "—";
}
