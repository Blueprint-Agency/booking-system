// The portal's Finance surface: the routes the Finance screen calls and the
// shapes it reads. Mirrors be/src/routes/portal/admin/finance.ts.
//
// Every figure on the screen comes out of ONE request, because the backend
// computes rows and tiles from one filtered set (be/src/services/finance/
// totals.ts). Nothing here adds anything up — if a total is wrong, it is wrong
// in one place, and that place is the backend.
//
// The CSV is the same read with the same filters, so the file a bookkeeper opens
// and the table an admin was looking at cannot describe different periods.
//
// Error copy is NOT duplicated here: a pay edit fails the same four ways it
// always has, so `payrollErrorMessage`/`payrollNeedsReload` are imported from
// ./payroll rather than restated.
import type { Api } from "@/lib/api";
import { rangeToParams, type DateRange } from "@/components/date-range-filter";
import { atLocalTime } from "@/lib/local-day";

export {
  payrollErrorMessage as financeErrorMessage,
  payrollNeedsReload as financeNeedsReload,
} from "./payroll";

/** Mirrors `MoneyEventKind` in be/src/services/finance/events.ts. */
export type MoneyEventKind =
  | "purchase"
  | "addon"
  | "workshop_ticket"
  | "corporate"
  | "merch"
  | "refund"
  | "instructor_pay"
  | "manual";

/** The Location filter value for rows that record no Location at all. */
export const UNATTRIBUTED = "unattributed";

export interface FinanceRow {
  kind: MoneyEventKind;
  id: string;
  occurred_at: string;
  ends_at: string | null;
  label: string;
  location_id: string | null;
  location_name: string | null;
  unattributed: boolean;
  list_price_sgd: number | null;
  paid_sgd: number | null;
  discount_sgd: number | null;
  promo_code: string | null;
  refunded: boolean;
  instructor_id: string | null;
  instructor_name: string | null;
  pay_sgd: number | null;
  /** A session whose pay has not been decided — not pay of zero. */
  unpriced: boolean;
  /** Which table a pay edit writes to. Null on every money-in row. */
  pay_kind: "class" | "pt" | "workshop" | "manual" | null;
  class_type_id: string | null;
  session_type: "1on1" | "2on1" | null;
  duration_minutes: number | null;
  /**
   * Whether this row's amount may be changed. Comes from the backend and is
   * NEVER re-derived here: a purchase or a Refund is the payment provider's
   * record, and a screen that decided for itself which rows were editable is
   * one bug away from letting an admin restate it.
   */
  editable: boolean;
}

export interface FinanceTotals {
  gross_sgd: number;
  discounts_sgd: number;
  refunds_sgd: number;
  instructor_pay_sgd: number;
  net_sgd: number;
}

export interface FinanceInstructorTotal {
  instructor_id: string;
  instructor_name: string;
  total_sgd: number;
  session_count: number;
}

export interface FinanceResponse {
  rows: FinanceRow[];
  /** Over the WHOLE filtered range — never the visible page. */
  totals: FinanceTotals;
  instructor_totals: FinanceInstructorTotal[];
  /** Sessions with no pay set. Counted, excluded from every total. */
  unpriced_count: number;
}

export interface FinanceFilters {
  instructorId?: string;
  classTypeId?: string;
  /** A Location id, or UNATTRIBUTED. Empty means every Location. */
  location?: string;
  needsPay?: boolean;
  range: DateRange;
}

/** Empty strings mean "no filter" — that is what a picker's "All" option is. */
const toParams = (f: FinanceFilters) => ({
  instructor_id: f.instructorId || undefined,
  class_type_id: f.classTypeId || undefined,
  location: f.location || undefined,
  needs_pay: f.needsPay ? "true" : undefined,
  ...rangeToParams(f.range),
});

export function fetchFinance(api: Api, filters: FinanceFilters): Promise<FinanceResponse> {
  return api.get<FinanceResponse>("/portal/admin/finance", toParams(filters));
}

/**
 * Download the filtered rows as CSV.
 *
 * The backend answers with text rather than JSON, which `apiFetch` hands back
 * as a string. Going through the same authenticated client matters: a plain
 * `<a href>` would carry no bearer token.
 */
export async function downloadFinanceCsv(api: Api, filters: FinanceFilters): Promise<void> {
  const csv = await api.get<string>("/portal/admin/finance/export", toParams(filters));
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  // A null range is the "All time" preset — name the file for it rather than
  // for two undefineds.
  const span = filters.range ? `${filters.range.from}-to-${filters.range.to}` : "all-time";
  a.download = `finance-${span}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* --------------------------------- Writes -------------------------------- */

/**
 * `instructor_id` targets this row's specific instructor (main/supporting/
 * workshop) — required for workshops, and needed for classes and PT sessions
 * with supporting instructors so the write doesn't fall through to the
 * main-instructor back-compat path. Pass the row, not its id, so it can't be
 * left off.
 */
export function saveInstructorPay(
  api: Api,
  row: FinanceRow,
  paySgd: number | null,
): Promise<unknown> {
  if (!row.pay_kind) throw new Error(`row ${row.kind} carries no pay to edit`);
  return api.patch(`/portal/admin/finance/pay/${row.pay_kind}/${row.id}`, {
    instructor_pay_sgd: paySgd,
    instructor_id: row.instructor_id,
  });
}

/** `day` is a YYYY-MM-DD from a date input; the API wants a local-midnight instant. */
export function createManualEntry(
  api: Api,
  entry: { instructorId: string; amountSgd: number; label: string; day: string },
): Promise<unknown> {
  return api.post("/portal/admin/finance/manual", {
    instructor_id: entry.instructorId,
    amount_sgd: entry.amountSgd,
    label: entry.label,
    entry_date: atLocalTime(entry.day, "00:00").toISOString(),
  });
}

/** Only Manual Entries can be deleted — the rest are records of work done. */
export function deleteManualEntry(api: Api, id: string): Promise<unknown> {
  return api.del(`/portal/admin/finance/manual/${id}`);
}
