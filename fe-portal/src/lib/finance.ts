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

/**
 * What the transaction was, in the studio's words. Mirrors `MoneyEventType` in
 * be/src/services/finance/events.ts — NOT the same axis as `kind`, which says
 * where the row came from and whether it can be edited.
 */
export type FinanceType =
  | "credit"
  | "unlimited"
  | "trial"
  | "pt_package"
  | "addon"
  | "workshop"
  | "corporate"
  | "merch"
  | "refund"
  | "class"
  | "pt_session"
  | "manual";

/**
 * Display names for the type column and the type filter — one source, so a
 * filter option can never read differently from the rows it selects.
 *
 * Insertion order IS the filter's order: what the studio sells first, then what
 * it pays for, then Refunds. The dropdown maps over this rather than keeping a
 * second list of the same twelve in a different order.
 */
export const FINANCE_TYPE_LABEL: Record<FinanceType, string> = {
  credit: "Credit",
  unlimited: "Unlimited",
  trial: "Trial",
  pt_package: "PT Package",
  addon: "Add-on",
  workshop: "Workshop",
  corporate: "Corporate",
  merch: "Merch",
  class: "Class",
  pt_session: "PT Session",
  manual: "Manual",
  refund: "Refund",
};

export const FINANCE_TYPES = Object.keys(FINANCE_TYPE_LABEL) as FinanceType[];

/** The Location filter value for rows that record no Location at all. */
export const UNATTRIBUTED = "unattributed";

export interface FinanceRow {
  kind: MoneyEventKind;
  type: FinanceType;
  id: string;
  occurred_at: string;
  ends_at: string | null;
  /** Which one of the type — "Bundle of 10", the class's name. */
  variant: string | null;
  /** The member who paid, or the instructor being paid. */
  user_name: string | null;
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
  /** One transaction type, or empty for every type. */
  type?: string;
  /** Free text over the member's or the instructor's name. */
  q?: string;
  /** A Location id, or UNATTRIBUTED. Empty means every Location. */
  location?: string;
  needsPay?: boolean;
  range: DateRange;
}

/** Empty strings mean "no filter" — that is what a picker's "All" option is. */
const toParams = (f: FinanceFilters) => ({
  type: f.type || undefined,
  q: f.q?.trim() || undefined,
  location: f.location || undefined,
  needs_pay: f.needsPay ? "true" : undefined,
  ...rangeToParams(f.range),
});

export function fetchFinance(api: Api, filters: FinanceFilters): Promise<FinanceResponse> {
  return api.get<FinanceResponse>("/portal/admin/finance", toParams(filters));
}

/* -------------------------------- Overview -------------------------------- */

export type SaleCategory = "classes" | "pt" | "workshops" | "corporate" | "merch";

export const SALE_CATEGORY_LABEL: Record<SaleCategory, string> = {
  classes: "Classes",
  pt: "Personal training",
  workshops: "Workshops",
  corporate: "Corporate",
  merch: "Merch",
};

export interface CategorySales {
  category: SaleCategory;
  /** Sums to the Gross tile across all categories. */
  gross_sgd: number;
  collected_sgd: number;
  count: number;
}

export interface ClassPopularity {
  class_type_id: string;
  name: string;
  /** Check-ins, not bookings. */
  attended: number;
  /** The same count over the equally-long window before. Null on All time. */
  previous: number | null;
}

export interface FinanceOverview {
  totals: FinanceTotals;
  /** Sessions with no pay set. Excluded from Net, so Net says so. */
  unpriced_count: number;
  sales_by_category: CategorySales[];
  by_instructor: FinanceInstructorTotal[];
  members: { active: number; joined: number };
  classes: ClassPopularity[];
}

/**
 * The overview reads ONLY a period — it deliberately ignores the ledger's
 * type/user/location filters. A "total sales" figure narrowed to one instructor
 * is not an overview, and a reader who scrolled past the filters would have no
 * way to tell that the number above them had moved.
 */
export function fetchFinanceOverview(api: Api, range: DateRange): Promise<FinanceOverview> {
  return api.get<FinanceOverview>("/portal/admin/finance/overview", rangeToParams(range));
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
