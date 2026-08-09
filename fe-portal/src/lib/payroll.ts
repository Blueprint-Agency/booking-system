// The portal's payroll surface: the routes both payroll screens call, the
// row/total shapes they read, and the one mapping from a failed pay edit to the
// sentence an admin reads. Mirrors be/src/routes/portal/{admin,instructor}/
// payroll.ts.
//
// The routes live here because the period is the thing that must not drift. A
// screen shows rows and totals side by side, and the backend computes both from
// one filtered set (be/src/services/payroll/totals.ts) — so as long as they come
// out of the SAME request, they cannot disagree. Every read below therefore
// takes the `DateRange` the filter produced and converts it once; no screen
// composes its own from/to, and no screen totals anything itself.
//
// The error copy lives here because a pay edit fails in four different ways that
// used to arrive as one anonymous 404 — the session was deleted, the instructor
// was taken off it, the amount was unusable, or nobody was named on a workshop.
// The screen showed "Couldn't save (HTTP 404)" for all four, so an admin could
// not tell which one to fix. `payrollErrorMessage` is the only place that
// translation happens, so the admin table and any future editor read alike.
//
// What is deliberately NOT unified:
//   - The two reads stay two functions. The admin gets a per-instructor
//     breakdown, an instructor gets one flat total for themselves, and the
//     instructor's identity is forced by the backend — an `instructor_id` sent
//     from that screen would be ignored, so the type refuses to carry one.
//   - This stays separate from `scheduleErrorMessage`. The two surfaces share
//     the wire shape but not one error, and a class edit and a pay edit fail for
//     entirely different reasons — one table of both would just be two tables in
//     a trench coat.
//
// Takes the backend handle as a parameter rather than reaching for React
// context, following `catalog.ts`.
import { ApiError, type Api } from "@/lib/api";
import { rangeToParams, type DateRange } from "@/components/date-range-filter";
import { atLocalTime } from "@/lib/local-day";

export interface ApiPayrollRow {
  kind: "class" | "pt" | "workshop" | "manual";
  id: string;
  instructor_id: string;
  instructor_name: string;
  /** null for workshops — they aren't tied to a single class type. */
  class_type_id: string | null;
  label: string;
  session_type: "1on1" | "2on1" | null;
  starts_at: string;
  ends_at: string;
  /** For workshops this is the full multi-day span, not a per-session duration. */
  duration_minutes: number;
  instructor_pay_sgd: number | null;
}

export interface ApiPayrollTotal {
  instructor_id: string;
  instructor_name: string;
  total_sgd: number;
  session_count: number;
}

export interface ApiPayrollResponse {
  rows: ApiPayrollRow[];
  /** Per instructor, over the same filtered set as `rows`. */
  totals: ApiPayrollTotal[];
  /** Rows with no pay set yet. Counted here, excluded from every total. */
  unpriced_count: number;
}

/** The instructor route answers with one flat total instead of a breakdown. */
export interface ApiInstructorPayrollResponse {
  rows: ApiPayrollRow[];
  total_sgd: number;
  session_count: number;
  unpriced_count: number;
}

export type PayrollSortKey =
  | "instructor"
  | "label"
  | "date"
  | "duration"
  | "amount";

export type SortDir = "asc" | "desc";

/* --------------------------------- Reads --------------------------------- */

/** Empty strings mean "no filter" — that is what the picker's "All" option is. */
export function fetchAdminPayroll(
  api: Api,
  filters: { instructorId?: string; classTypeId?: string; range: DateRange },
): Promise<ApiPayrollResponse> {
  return api.get<ApiPayrollResponse>("/portal/admin/payroll", {
    instructor_id: filters.instructorId || undefined,
    class_type_id: filters.classTypeId || undefined,
    ...rangeToParams(filters.range),
  });
}

/** The caller's own teaching log; the backend scopes it, never the query. */
export function fetchInstructorPayroll(
  api: Api,
  range: DateRange,
): Promise<ApiInstructorPayrollResponse> {
  return api.get<ApiInstructorPayrollResponse>(
    "/portal/instructor/payroll",
    rangeToParams(range),
  );
}

/* --------------------------------- Writes -------------------------------- */

/**
 * `instructor_id` targets this row's specific instructor (main/supporting/
 * workshop) — required for workshops, and needed for classes and PT sessions
 * with supporting instructors so the write doesn't fall through to the
 * main-instructor back-compat path. Pass the row, not its id, so it can't be
 * left off.
 */
export function savePayrollAmount(
  api: Api,
  row: ApiPayrollRow,
  paySgd: number | null,
): Promise<unknown> {
  return api.patch(`/portal/admin/payroll/${row.kind}/${row.id}`, {
    instructor_pay_sgd: paySgd,
    instructor_id: row.instructor_id,
  });
}

/** `day` is a YYYY-MM-DD from a date input; the API wants a local-midnight instant. */
export function createManualPayroll(
  api: Api,
  entry: { instructorId: string; amountSgd: number; label: string; day: string },
): Promise<unknown> {
  return api.post("/portal/admin/payroll", {
    instructor_id: entry.instructorId,
    amount_sgd: entry.amountSgd,
    label: entry.label,
    entry_date: atLocalTime(entry.day, "00:00").toISOString(),
  });
}

/** Only manual entries can be deleted — the rest are records of work done. */
export function deleteManualPayroll(api: Api, id: string): Promise<unknown> {
  return api.del(`/portal/admin/payroll/manual/${id}`);
}

/* ------------------------------- Error copy ------------------------------- */

/** Mirrors `PayrollSaveReason` in be/src/services/payroll/save-reasons.ts. */
export type PayrollSaveReason =
  | "record_not_found"
  | "instructor_not_assigned"
  | "invalid_amount"
  | "instructor_required";

// Fallback wording only — the backend sends a `message` naming the KIND of
// record ("that private session…"), which `payrollErrorMessage` prefers.
const PAYROLL_ERROR_COPY: Record<string, string> = {
  record_not_found:
    "That row no longer exists — it was deleted or cancelled. Reload the payroll list.",
  instructor_not_assigned:
    "That instructor is no longer on this session, so there is no pay to set. Reload the payroll list.",
  invalid_amount: "Enter an amount of zero or more.",
  instructor_required: "Pick which instructor's pay to change.",
};

/**
 * Admin-readable copy for a failed payroll save or delete. `fallback` names the
 * action for codes with no copy of their own ("Couldn't save (HTTP 500).").
 */
export function payrollErrorMessage(err: unknown, fallback = "Couldn't save"): string {
  if (!(err instanceof ApiError)) return "Network error";
  const body = err.body as { error?: string; message?: string } | null;
  if (typeof body?.message === "string" && body.message) return body.message;
  const known = body?.error ? PAYROLL_ERROR_COPY[body.error] : undefined;
  return known ?? `${fallback} (HTTP ${err.status}).`;
}

/**
 * The row the admin was editing is gone or has moved on — the list on screen is
 * stale and reloading is the only way to show the truth. 404/409 are exactly the
 * two statuses `payrollSaveStatus` uses for that; anything else (a 400, a 500)
 * leaves the admin's typed draft alone so they can correct and retry.
 */
export function payrollNeedsReload(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 409);
}
