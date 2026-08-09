// The portal's payroll surface: the row/total shapes both payroll screens read,
// and the one mapping from a failed pay edit to the sentence an admin reads.
// Shapes mirror be/src/routes/portal/{admin,instructor}/payroll.ts.
//
// The error copy lives here because a pay edit fails in four different ways that
// used to arrive as one anonymous 404 — the session was deleted, the instructor
// was taken off it, the amount was unusable, or nobody was named on a workshop.
// The screen showed "Couldn't save (HTTP 404)" for all four, so an admin could
// not tell which one to fix. `payrollErrorMessage` is the only place that
// translation happens, so the admin table and any future editor read alike.
//
// What is deliberately NOT unified: this stays separate from
// `scheduleErrorMessage`. The two surfaces share the wire shape but not one
// error, and a class edit and a pay edit fail for entirely different reasons —
// one table of both would just be two tables in a trench coat.
import { ApiError } from "@/lib/api";

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
  totals: ApiPayrollTotal[];
  unpriced_count: number;
}

export type PayrollSortKey =
  | "instructor"
  | "label"
  | "date"
  | "duration"
  | "amount";

export type SortDir = "asc" | "desc";

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
