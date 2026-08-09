// The portal's schedule surface: reading, editing and cancelling a scheduled
// event, plus the one mapping from a backend error code to the sentence an
// admin reads. Shapes mirror be/src/routes/portal/admin/{schedule,pt-sessions,
// corporate-sessions}.ts.
//
// Two things live here because callers kept getting them wrong:
//
// 1. **Envelopes.** Three conventions coexist on this surface — a class or PT
//    detail is the bare body, a corporate session comes wrapped as
//    `{ corporate_session }` (snake) and its package as `{ corporatePackage }`
//    (camel). Unwrapping happens here so a screen never has to know which.
// 2. **Error copy.** The class and PT mappings were byte-identical copies, with
//    a third inline in the workshop editor and a fourth on the new-class form.
//    A room clash now reads the same wherever it happens.
//
// What is deliberately NOT unified: the patch payloads. The three kinds differ
// in ways that fail silently if smoothed over — PT sends `instructor_id` where
// class sends `main_instructor_id`, corporate sends a bare
// `supporting_instructor_ids` array and no pay fields at all, and a PT
// cancellation posts against the *request* id, not the session id. Each kind
// keeps its own input type so the compiler holds the difference in place.
//
// Takes the backend handle as a parameter rather than reaching for React
// context, following `catalog.ts`.

import { ApiError, type Api } from "@/lib/api";

export interface NamedRef {
  id: string;
  name: string;
}

export type ClassDifficulty = "general" | "beginner" | "intermediate" | "advanced";

export interface ScheduleClassAttendee {
  booking_id: string;
  client: NamedRef;
  package_kind: "credit_bundle" | "unlimited" | "trial" | "pt" | null;
  credits_used: number;
  check_in_state: "pending" | "attended" | "no_show" | "n_a";
  code: string;
}

export interface ScheduleClassDetail {
  id: string;
  lifecycle: "active" | "cancelled";
  starts_at: string;
  ends_at: string;
  class_type: NamedRef | null;
  difficulty: ClassDifficulty;
  instructor: NamedRef | null;
  main_instructor_id: string | null;
  instructor_pay_sgd: number | null;
  supporting_instructor_ids: string[];
  supporting_instructors: (NamedRef & { pay_sgd: number | null })[];
  instructor_ids: string[];
  location: NamedRef | null;
  room: NamedRef | null;
  capacity_online: number;
  capacity_waitlist: number;
  capacity_buffer: number;
  credit_cost: number;
  booked_count: number;
  attendees: ScheduleClassAttendee[];
  created_at: string;
  scheduled_by: NamedRef | null;
}

export interface SchedulePtAttendee {
  id: string;
  name: string;
  code: string | null;
  check_in_state: "pending" | "attended" | "no_show" | "n_a" | null;
}

export interface SchedulePtDetail {
  id: string;
  /** Cancellation posts against this, NOT `id`. See `cancelPtRequest`. */
  pt_request_id: string;
  lifecycle: "active" | "cancelled";
  starts_at: string;
  ends_at: string;
  session_type: "1on1" | "2on1";
  instructor: NamedRef | null;
  main_instructor_id: string;
  instructor_pay_sgd: number | null;
  supporting_instructors: (NamedRef & { pay_sgd: number | null })[];
  location: NamedRef | null;
  room: NamedRef | null;
  capacity_online: number;
  capacity_waitlist: number;
  capacity_buffer: number;
  clients: SchedulePtAttendee[];
}

export interface ScheduleCorporateSession {
  id: string;
  corporate_package_id: string;
  client_name: string;
  main_instructor_id: string;
  supporting_instructor_ids: string[];
  location_id: string | null;
  location_text: string | null;
  room_id: string | null;
  starts_at: string;
  ends_at: string;
  lifecycle: "active" | "cancelled";
  cancelled_at: string | null;
}

export interface ScheduleCorporatePackageBrief {
  id: string;
  name: string;
  status: "active" | "archived";
}

/* ------------------------------- Reads ------------------------------- */

export function fetchClassDetail(api: Api, id: string): Promise<ScheduleClassDetail> {
  return api.get<ScheduleClassDetail>(`/portal/admin/schedule/classes/${id}`);
}

export function fetchPtDetail(api: Api, id: string): Promise<SchedulePtDetail> {
  return api.get<SchedulePtDetail>(`/portal/admin/schedule/pt/${id}`);
}

export async function fetchCorporateSession(
  api: Api,
  id: string,
): Promise<ScheduleCorporateSession> {
  const res = await api.get<{ corporate_session: ScheduleCorporateSession }>(
    `/portal/admin/corporate-sessions/${id}`,
  );
  return res.corporate_session;
}

/** Note the camelCase envelope — this route does not match its neighbours. */
export async function fetchCorporatePackageBrief(
  api: Api,
  id: string,
): Promise<ScheduleCorporatePackageBrief> {
  const res = await api.get<{ corporatePackage: ScheduleCorporatePackageBrief }>(
    `/portal/admin/corporate-packages/${id}`,
  );
  return res.corporatePackage;
}

/* ------------------------------- Edits ------------------------------- */

interface SupportingPay {
  instructor_id: string;
  pay_sgd: number | null;
}

export interface ClassPatch {
  class_type_id: string;
  main_instructor_id: string;
  instructor_pay_sgd: number | null;
  supporting_instructors: SupportingPay[];
  location_id: string;
  room_id: string;
  starts_at: string;
  ends_at: string;
}

/** PT names the main instructor `instructor_id`, not `main_instructor_id`. */
export interface PtPatch {
  session_type: "1on1" | "2on1";
  instructor_id: string;
  instructor_pay_sgd: number | null;
  supporting_instructors: SupportingPay[];
  location_id: string;
  room_id: string;
  starts_at: string;
  ends_at: string;
}

/** Corporate takes bare supporting ids and carries no pay fields. */
export interface CorporatePatch {
  client_name: string;
  main_instructor_id: string;
  supporting_instructor_ids: string[];
  location_id: string;
  room_id: string;
  starts_at: string;
  ends_at: string;
}

export function patchClass(api: Api, classId: string, input: ClassPatch): Promise<unknown> {
  return api.patch(`/portal/admin/schedule/classes/${classId}`, input);
}

export function patchPtSession(api: Api, sessionId: string, input: PtPatch): Promise<unknown> {
  return api.patch(`/portal/admin/pt-sessions/sessions/${sessionId}`, input);
}

export function patchCorporateSession(
  api: Api,
  sessionId: string,
  input: CorporatePatch,
): Promise<unknown> {
  return api.patch(`/portal/admin/corporate-sessions/${sessionId}`, input);
}

export function cancelClass(api: Api, classId: string): Promise<unknown> {
  return api.post(`/portal/admin/schedule/classes/${classId}/cancel`);
}

/**
 * Cancelling a private session is done against the PT *request* — pass
 * `SchedulePtDetail.pt_request_id`, never the session id.
 */
export function cancelPtRequest(api: Api, ptRequestId: string): Promise<unknown> {
  return api.post(`/portal/admin/pt-sessions/${ptRequestId}/cancel`);
}

export function cancelCorporateSession(api: Api, sessionId: string): Promise<unknown> {
  return api.post(`/portal/admin/corporate-sessions/${sessionId}/cancel`);
}

/* ------------------------------- Error copy ------------------------------- */

// One sentence per backend error code, for every kind of scheduled event.
// `not_found` / `*_not_found` codes below are corporate-only; class and PT
// not-found codes are `class_not_found` / `pt_session_not_found` and fall
// through to the generic message.
const SCHEDULE_ERROR_COPY: Record<string, string> = {
  // One clash, two backend spellings: the shared schedule helper throws
  // `room_clash`, and the PT and corporate routes translate it to
  // `room_conflict`.
  room_clash: "That room is already booked for an overlapping time. Pick another room or time.",
  room_conflict: "That room is already booked for an overlapping time. Pick another room or time.",
  room_location_mismatch: "That room belongs to a different location.",
  instructor_conflict: "The main instructor has another session at that time.",
  package_archived: "This corporate package is archived and can't be scheduled.",
  // Same mistake, two backend spellings again: the roster module (classes,
  // workshops, PT) refuses with `supporting_instructor_duplicates_main`, the
  // corporate routes with `main_in_supporting`.
  supporting_instructor_duplicates_main: "An instructor can't be both main and supporting.",
  main_in_supporting: "An instructor can't be both main and supporting.",
  bad_time_range: "End time must be after start time.",
  package_not_found: "Corporate package not found.",
  request_not_found: "Corporate request not found.",
  not_pending: "This request is no longer pending — it may already be scheduled or cancelled.",
  not_found: "Corporate session not found.",
};

/**
 * Admin-readable copy for a failed schedule read, save or cancel. `fallback`
 * names the action for codes with no copy of their own ("Save failed (HTTP
 * 500).").
 */
export function scheduleErrorMessage(err: unknown, fallback = "Save failed"): string {
  if (!(err instanceof ApiError)) return "Network error";
  const code = (err.body as { error?: string } | null)?.error;
  const known = code ? SCHEDULE_ERROR_COPY[code] : undefined;
  return known ?? `${fallback} (HTTP ${err.status}).`;
}
