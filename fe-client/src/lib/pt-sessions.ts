"use client";

/**
 * Live API helpers for PT session requests.
 * Auth pattern: `useApi()` from api.ts (Clerk `getToken` → `Authorization: Bearer`).
 * Errors: non-2xx throws `ApiError`; callers can inspect `err.body` for BE error codes
 * (e.g. `{ error: "insufficient_pt_credit" }`).
 */
import { useApi, type Api } from "./api";

// ── Request types ─────────────────────────────────────────────────────────────

export interface PtSlot {
  proposedDate: string; // "YYYY-MM-DD"
  startTime: string;    // "HH:mm"
  endTime: string;      // "HH:mm"
}

export interface PtPartner {
  kind: "existing" | "new";
  coClientId?: string;
  name?: string;
  email?: string;
}

export interface SubmitPtRequestPayload {
  classTypeId: string;
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

export interface RawPtRequest {
  id: string;
  session_type: "1on1" | "2on1";
  status: string;
  class_type_id: string;
  class_type_name?: string;
  location_id: string;
  location_name?: string;
  slots: PtSlot[];
  message?: string | null;
  partner?: PtPartner | null;
  created_at: string;
  updated_at?: string;
}

export interface ListPtRequestsResult {
  pt_requests: RawPtRequest[];
}

export interface PartnerLookupResult {
  found: boolean;
  client_id?: string;
  name?: string;
}

// ── API helpers (take an Api instance from useApi()) ─────────────────────────

export function makePtSessionsApi(api: Api) {
  return {
    /** POST /me/pt-sessions/request */
    submitRequest: (payload: SubmitPtRequestPayload) =>
      api.post<SubmitPtRequestResult>("/me/pt-sessions/request", payload),

    /** GET /me/pt-sessions/ */
    listRequests: () =>
      api.get<ListPtRequestsResult>("/me/pt-sessions/"),

    /** POST /me/pt-sessions/:id/cancel */
    cancelRequest: (id: string) =>
      api.post<void>(`/me/pt-sessions/${id}/cancel`),

    /** GET /me/pt-sessions/partner-lookup?email= */
    partnerLookup: (email: string) =>
      api.get<PartnerLookupResult>("/me/pt-sessions/partner-lookup", { email }),
  };
}

/** Hook: authed PT sessions API bound to the current Clerk session. */
export function usePtSessionsApi() {
  const api = useApi();
  return makePtSessionsApi(api);
}
