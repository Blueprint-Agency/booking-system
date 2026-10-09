"use client";

/**
 * The member's Receipts — `GET /me/receipts` (#384). Newest first, a page at a
 * time, with a date range to pull out a year's worth. Each opens the Receipt
 * itself at `/account/receipts/[id]`.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, ReceiptText } from "lucide-react";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ContentLoading } from "@/components/ui/content-loading";
import { CARD } from "@/components/ui/styles";
import { useApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import {
  dateRangeProblem,
  receiptAmount,
  receiptsQuery,
  receiptStatusLabel,
  type ReceiptsPage,
} from "@/lib/receipts";

const dateInput =
  "min-h-[44px] w-full rounded-xl border border-ink/10 bg-card px-3 text-sm text-ink focus:border-accent focus:outline-none";

export default function AccountReceiptsPage() {
  const api = useApi();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ReceiptsPage | null>(null);
  const [error, setError] = useState(false);
  const problem = dateRangeProblem(from, to);

  useEffect(() => {
    if (problem) return;
    let cancelled = false;
    setError(false);
    api
      .get<ReceiptsPage>("/me/receipts", receiptsQuery({ from, to, page }))
      .then((res) => !cancelled && setResult(res))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
    // The api client is rebuilt on every render; the fetch follows the filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, page, problem]);

  const filtered = Boolean(from || to);
  const pages = result ? Math.max(1, Math.ceil(result.total / result.page_size)) : 1;

  return (
    <div>
      <AccountPageHeader title="Receipts" description="The studio's receipt for everything you've bought." />

      <fieldset className="mb-5 grid grid-cols-2 gap-3 sm:max-w-md">
        <legend className="sr-only">Filter by date</legend>
        <label className="text-xs font-semibold text-muted">
          From
          <input
            type="date"
            className={`${dateInput} mt-1`}
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="text-xs font-semibold text-muted">
          To
          <input
            type="date"
            className={`${dateInput} mt-1`}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
        {problem && (
          <p role="alert" className="col-span-2 text-sm text-error">
            {problem}
          </p>
        )}
        {filtered && (
          <button
            type="button"
            className="col-span-2 justify-self-start text-sm font-semibold text-accent-deep hover:text-accent"
            onClick={() => {
              setFrom("");
              setTo("");
              setPage(1);
            }}
          >
            Clear dates
          </button>
        )}
      </fieldset>

      {!result && !error && <ContentLoading label="Loading receipts" />}

      {error && (
        <div role="alert" className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          We couldn&apos;t load your receipts right now. Please refresh in a moment.
        </div>
      )}

      {result && !error && result.receipts.length === 0 && (
        <div className={CARD}>
          <EmptyState
            icon={ReceiptText}
            title={filtered ? "No receipts in these dates" : "No receipts yet"}
            description={
              filtered
                ? "Try a wider range, or clear the dates to see them all."
                : "When you buy a package, its receipt shows up here."
            }
            cta={filtered ? undefined : { href: "/packages", label: "Browse packages" }}
          />
        </div>
      )}

      {result && !error && result.receipts.length > 0 && (
        <>
          <ul className={`divide-y divide-ink/5 ${CARD}`}>
            {result.receipts.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/account/receipts/${r.id}`}
                  className="flex items-center gap-3 px-4 py-3 sm:px-5 sm:py-4 hover:bg-ink/[0.02] transition-colors"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/8 text-accent-deep">
                    <ReceiptText className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{r.item}</p>
                    <p className="text-xs text-muted">
                      <span className="tabular-nums">{r.number}</span> · {formatDate(r.issued_at)} ·{" "}
                      <span className={r.status === "refunded" ? "font-semibold text-error" : undefined}>
                        {receiptStatusLabel(r.status)}
                      </span>
                    </p>
                  </div>
                  <span className="whitespace-nowrap text-sm font-bold text-ink tabular-nums">
                    {receiptAmount(r.total_sgd)}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <nav aria-label="Receipt pages" className="mt-4 flex items-center justify-between text-sm">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="min-h-[44px] rounded-full px-4 font-semibold text-accent-deep disabled:text-muted"
              >
                Newer
              </button>
              <span className="text-muted tabular-nums">
                Page {page} of {pages}
              </span>
              <button
                type="button"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
                className="min-h-[44px] rounded-full px-4 font-semibold text-accent-deep disabled:text-muted"
              >
                Older
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
