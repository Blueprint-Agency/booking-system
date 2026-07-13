// Shapes for the /portal/admin/payroll surface. See be/src/routes/portal/admin/payroll.ts.

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
