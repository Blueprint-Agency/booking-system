"use client";

/**
 * Live API helpers for PT session requests.
 * Auth pattern: `useApi()` from api.ts (member session token → `Authorization: Bearer`).
 * Errors: non-2xx throws `ApiError`; callers can inspect `err.body` for BE error codes
 * (e.g. `{ error: "insufficient_pt_credit" }`).
 */
import { useApi, type Api } from "./api";

// ── Request types ─────────────────────────────────────────────────────────────

export interface PtSlot {
  proposedDate: string; // "YYYY-MM-DD"
  startTime: string;    // "HH:mm", on the hour or half hour
}

export interface PtPartner {
  kind: "existing" | "new";
  coClientId?: string;
  name?: string;
  email?: string;
}

export interface SubmitPtRequestPayload {
  /** Preferred class type; null means "any". */
  classTypeId: string | null;
  locationId: string;
  sessionType: "1on1" | "2on1";
  clientPackageId: string;
  slots: PtSlot[];
  message?: string;
  partner?: PtPartner | null;
}

export interface SubmitPtRequestResult {
  pt_request_id: string;
}

// ── Response types ────────────────────────────────────────────────────────────

/** Snake_case slot shape as returned by the BE list endpoint. */
export interface RawPtSlot {
  proposed_date: string;
  start_time: string;
  /** Null on requests made since members propose a start time only. */
  end_time: string | null;
}

export interface RawPtRequest {
  id: string;
  session_type: "1on1" | "2on1";
  status: string;
  refund_outcome?: "session_returned" | "forfeited" | "n_a" | null;
  // Is the caller the requester (owns the credit, can cancel) or the 2on1 partner (read-only)?
  role?: "requester" | "partner";
  // The requester's name — shown on partner cards ("hosted by …").
  host_name?: string | null;
  // Both null when the member asked for "any" class type.
  class_type_id?: string | null;
  class_name?: string | null;
  location_id?: string;
  location_name?: string;
  slots: RawPtSlot[];
  message?: string | null;
  co_client_name?: string | null;
  created_at: string;
  updated_at?: string;
  expires_at?: string | null;
  // Present once scheduled — the confirmed session + this member's check-in booking.
  session?: {
    starts_at: string;
    ends_at: string;
    instructor_name: string | null;
    room_name: string | null;
  } | null;
  booking?: {
    qr_token: string;
    code: string;
    check_in_state: "pending" | "attended" | "no_show" | "n_a";
    refund_outcome?: "session_returned" | "forfeited" | "n_a" | null;
  } | null;
}

export interface ListPtRequestsResult {
  pt_requests: RawPtRequest[];
}

/** What a cancel did: whether the sessions it held came back, and how many. */
export interface CancelPtRequestResult {
  ok: true;
  status: "cancelled_before_scheduled" | "cancelled_after_scheduled" | "noop";
  refundedSessions: number;
  refundOutcome: "session_returned" | "forfeited" | "n_a";
}

export interface PartnerLookupResult {
  found: boolean;
  client_id?: string;
  name?: string;
}

// ── Slot times ───────────────────────────────────────────────────────────────

/** Every start a member can propose: the hour and half hour, "00:00"…"23:30". */
export const HALF_HOUR_TIMES: string[] = Array.from({ length: 48 }, (_, i) =>
  `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);

/** "HH:mm" or "HH:mm:ss" → "9:30 am", the way class times read elsewhere. */
export function formatSlotTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** A proposed slot's time: its start, and its end on requests that had one. */
export function formatSlotRange(slot: RawPtSlot): string {
  return slot.end_time
    ? `${formatSlotTime(slot.start_time)}–${formatSlotTime(slot.end_time)}`
    : formatSlotTime(slot.start_time);
}

// ── API helpers (take an Api instance from useApi()) ─────────────────────────

export function makePtSessionsApi(api: Api) {
  return {
    /** POST /me/pt-sessions/request */
    submitRequest: (payload: SubmitPtRequestPayload) =>
      api.post<SubmitPtRequestResult>("/me/pt-sessions/request", payload),

    /** GET /me/pt-sessions */
    listRequests: () =>
      api.get<ListPtRequestsResult>("/me/pt-sessions"),

    /** POST /me/pt-sessions/:id/cancel */
    cancelRequest: (id: string) =>
      api.post<CancelPtRequestResult>(`/me/pt-sessions/${id}/cancel`),

    /** GET /me/pt-sessions/partner-lookup?email= */
    partnerLookup: (email: string) =>
      api.get<PartnerLookupResult>("/me/pt-sessions/partner-lookup", { email }),
  };
}

/** Hook: authed PT sessions API bound to the member's session. */
export function usePtSessionsApi() {
  const api = useApi();
  return makePtSessionsApi(api);
}
