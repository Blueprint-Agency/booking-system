// Wire shape for the admin PT-request triage queue.
// Mirrors be/src/routes/portal/admin/pt-sessions.ts `serialize()`.

export type PtStatus =
  | "pending"
  | "scheduled"
  | "cancelled_before_scheduled"
  | "cancelled_after_scheduled"
  | "attended";

export interface ApiPtRequest {
  id: string;
  status: PtStatus;
  session_type: "1on1" | "2on1";
  message: string | null;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  client: { id: string; name: string; email: string };
  class_type: { id: string; name: string };
  location: { id: string; name: string };
  // Only present for 2on1. clientId is null when the partner isn't a member yet.
  co_client: { clientId: string | null; name: string | null; email: string | null } | null;
  slots: { proposed_date: string; start_time: string; end_time: string }[];
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
  cancelled_before_scheduled: "cancelled (refunded)",
  cancelled_after_scheduled: "cancelled (forfeited)",
  attended: "attended",
};

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
