"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Loader2, ReceiptText, Search } from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, Input, PageHeader, Pagination, Select } from "@/components/ui";
import { DateRangeFilter } from "@/components/date-range-filter";
import { ReceiptStatusBadge as StatusBadge } from "@/components/receipts/receipt-status-badge";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import { getPortalToken } from "@/lib/portal-auth";
import { formatDate } from "@/lib/formatters";
import {
  RECEIPT_KINDS,
  readReceiptsState,
  receiptAmount,
  receiptKindLabel,
  receiptsExportPath,
  receiptsQuery,
  receiptsSearch,
  type ReceiptKind,
  type ReceiptsPage,
  type ReceiptsState,
  type ReceiptStatus,
} from "@/lib/receipts";

/** Wait this long after the last keystroke before searching the whole studio. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Every Receipt in the studio (#389), newest first: searched by receipt
 * number, member name or email, and narrowed by day, kind and status. Each row
 * opens the Receipt as the member sees it. Admins only; the backend refuses an
 * instructor every receipt route.
 */
export default function ReceiptsPageRoute() {
  // `useSearchParams` needs a Suspense boundary above it.
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading receipts…
        </div>
      }
    >
      <ReceiptsList />
    </Suspense>
  );
}

function ReceiptsList() {
  const { api } = useWorkspace();
  const searchParams = useSearchParams();
  // Read once: afterwards the list owns its position and writes it back.
  const [state, setState] = useState<ReceiptsState>(() => readReceiptsState(searchParams.toString()));
  // What is typed, ahead of the debounced `state.q` the backend is asked for.
  const [query, setQuery] = useState(state.q);
  const [result, setResult] = useState<ReceiptsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Retry, to ask for the same list again.
  const [attempt, setAttempt] = useState(0);
  // The list as asked for, and the attempt: what the shown result or error answers.
  const asked = `${JSON.stringify(state)}#${attempt}`;
  const [answered, setAnswered] = useState<string | null>(null);
  const loading = answered !== asked;

  // Anything but a page move starts again at page one.
  const update = useCallback((patch: Partial<ReceiptsState>) => {
    setState((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  }, []);

  useEffect(() => {
    const qs = receiptsSearch(state);
    window.history.replaceState(null, "", qs || window.location.pathname);
  }, [state]);

  useEffect(() => {
    if (query.trim() === state.q) return;
    const t = setTimeout(() => update({ q: query.trim() }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, state, update]);

  // Only the newest request may paint: a newer one cancels the one before.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    api.get<ReceiptsPage>("/portal/admin/receipts", receiptsQuery(state)).then(
      (res) => {
        if (cancelled) return;
        setResult(res);
        setError(null);
        setAnswered(asked);
      },
      (err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
        setAnswered(asked);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, state, asked]);

  const rows = result?.receipts ?? [];
  const total = result?.total ?? 0;
  const filtered = Boolean(state.q || state.from || state.to || state.kind !== "all" || state.status !== "all");
  const detailHref = (id: string) => `/admin/receipts/${id}`;

  // Every Receipt the search and filters keep, every page of them, for the
  // bookkeeper (#390). Fetched with the staff session, as the PDF is.
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile(getPortalToken, receiptsExportPath(state), {
        fallbackName: "receipts.csv",
        failure: "The receipts could not be exported.",
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "The receipts could not be exported.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Receipts"
        description="Every receipt your studio has issued, exactly as the member received it. Receipts cannot be edited; a refunded one says so."
        actions={
          <Button
            type="button"
            variant="secondary"
            disabled={exporting || total === 0}
            onClick={() => void exportCsv()}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            Export CSV
          </Button>
        }
      />

      <div className="mb-4 space-y-3 rounded-xl border border-border bg-card p-4 shadow-soft">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="relative w-full sm:max-w-md sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              type="search"
              placeholder="Search by receipt number, name or email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              aria-label="Search receipts"
            />
          </div>
          <Select
            value={state.kind}
            onChange={(e) => update({ kind: e.target.value as ReceiptKind | "all" })}
            className="h-9 w-auto py-1 text-xs sm:h-8"
            aria-label="Filter by kind"
          >
            <option value="all">Every kind</option>
            {RECEIPT_KINDS.map((k) => (
              <option key={k} value={k}>
                {receiptKindLabel(k)}
              </option>
            ))}
          </Select>
          <Select
            value={state.status}
            onChange={(e) => update({ status: e.target.value as ReceiptStatus | "all" })}
            className="h-9 w-auto py-1 text-xs sm:h-8"
            aria-label="Filter by status"
          >
            <option value="all">Issued and refunded</option>
            <option value="issued">Issued</option>
            <option value="refunded">Refunded</option>
          </Select>
          <span className="ml-auto text-xs tabular-nums text-muted" aria-live="polite">
            {result ? `${total.toLocaleString()} receipt${total === 1 ? "" : "s"}` : ""}
          </span>
        </div>
        <DateRangeFilter
          value={state.from && state.to ? { from: state.from, to: state.to } : null}
          onChange={(r) => update({ from: r?.from ?? "", to: r?.to ?? "" })}
        />
      </div>

      <div className="rounded-xl border border-border bg-card shadow-soft">
        {loading && !result ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading receipts…
          </div>
        ) : error && !loading ? (
          <div className="py-12 text-center">
            <p className="text-sm text-error">Failed to load: {error}</p>
            <Button size="sm" variant="ghost" onClick={() => setAttempt((n) => n + 1)} className="mt-2">
              Retry
            </Button>
          </div>
        ) : rows.length === 0 && total === 0 && !filtered ? (
          <EmptyState
            icon={ReceiptText}
            title="No receipts yet"
            description="A receipt is issued the moment a purchase is paid in full, and is listed here."
          />
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {/* Mobile cards */}
            <ul className="divide-y divide-border sm:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link
                    href={detailHref(r.id)}
                    className="block px-4 py-3.5 hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium tabular-nums text-ink">{r.number}</span>
                      <StatusBadge status={r.status} />
                      <span className="ml-auto text-sm font-medium tabular-nums text-ink">{receiptAmount(r.total_sgd)}</span>
                    </div>
                    <div className="mt-1 truncate text-sm text-ink">{r.item}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                      <span className="truncate">{buyerOf(r)}</span>
                      <span>{formatDate(r.issued_at, "d MMM yyyy")}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[760px]">
                <thead className="bg-paper">
                  <tr className="text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-5 py-3 font-medium">Receipt</th>
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 font-medium">Member</th>
                    <th className="px-5 py-3 font-medium">Item</th>
                    <th className="px-5 py-3 text-right font-medium">Total</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-paper">
                      <td className="whitespace-nowrap px-5 py-3">
                        <Link
                          href={detailHref(r.id)}
                          className="rounded-md font-medium tabular-nums text-ink hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {r.number}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-sm text-muted">{formatDate(r.issued_at, "d MMM yyyy")}</td>
                      <td className="max-w-[16rem] px-5 py-3">
                        <div className="truncate text-sm text-ink">{r.buyer_name ?? "Deleted member"}</div>
                        {r.buyer_email && (
                          <div className="truncate text-xs text-muted" title={r.buyer_email}>
                            {r.buyer_email}
                          </div>
                        )}
                      </td>
                      <td className="max-w-[16rem] px-5 py-3">
                        <div className="truncate text-sm text-ink" title={r.item}>
                          {r.item}
                        </div>
                        <div className="text-xs text-muted">{receiptKindLabel(r.kind)}</div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right text-sm font-medium tabular-nums text-ink">
                        {receiptAmount(r.total_sgd)}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rows.length === 0 && (
              <div className="px-4 py-12 text-center text-sm text-muted">
                {total > 0 ? (
                  "Nothing on this page."
                ) : (
                  <>
                    No receipts match.
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-1"
                      onClick={() => {
                        setQuery("");
                        update({ q: "", from: "", to: "", kind: "all", status: "all" });
                      }}
                    >
                      Clear search and filters
                    </Button>
                  </>
                )}
              </div>
            )}

            <Pagination
              page={state.page}
              pageSize={state.pageSize}
              total={total}
              loading={loading}
              noun="receipts"
              onPageChange={(n) => update({ page: n })}
              onPageSizeChange={(n) => update({ pageSize: n })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function buyerOf(r: { buyer_name: string | null; buyer_email: string | null }): string {
  return r.buyer_name ?? r.buyer_email ?? "Deleted member";
}
