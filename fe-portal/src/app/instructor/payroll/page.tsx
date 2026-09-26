"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, Wallet } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import {
  DateRangeFilter,
  presetRange,
  type DateRange,
} from "@/components/date-range-filter";
import { useWorkspace } from "@/lib/workspace-context";
import { formatDate, formatDuration, formatSgd } from "@/lib/formatters";
import {
  fetchInstructorPayroll,
  payrollErrorMessage,
  type ApiInstructorPayrollResponse,
  type ApiPayrollRow,
} from "@/lib/payroll";
import { cn } from "@/lib/utils";

export default function InstructorPayrollPage() {
  const { api } = useWorkspace();
  const [range, setRange] = useState<DateRange>(() => presetRange("month"));
  const [data, setData] = useState<ApiInstructorPayrollResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    // Drop the old period's figures before asking for the new one's — a total
    // sitting above a loading table is a total for a period you can't see.
    setData(null);
    try {
      setData(await fetchInstructorPayroll(api, range));
    } catch (err) {
      setError(payrollErrorMessage(err, "Couldn't load payroll"));
    } finally {
      setLoading(false);
    }
  }, [api, range]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Teaching log"
        description="Your completed classes and private sessions, and the pay recorded for each. Amounts are set by an admin."
      />

      <div className="mb-4 rounded-xl border border-border bg-card p-3 shadow-soft">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {data && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Wallet className="h-4 w-4" />
              {data.session_count}{" "}
              {data.session_count === 1 ? "completed session" : "completed sessions"}
            </div>
            <div className="text-lg font-semibold tabular-nums text-ink">
              {formatSgd(data.total_sgd)}
            </div>
          </div>
        </div>
      )}

      {data && data.unpriced_count > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {data.unpriced_count}{" "}
          {data.unpriced_count === 1 ? "session has" : "sessions have"} no pay set
          yet — the total excludes them until an admin fills them in.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !data || data.rows.length === 0 ? (
        <EmptyState
          title="No completed sessions"
          description="Classes and private sessions you've taught appear here once they've finished."
        />
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-soft">
          {/* Below md each session is a stacked row — four columns don't fit a
              phone, and a sideways-scrolling table hides the pay off-screen. */}
          <ul className="divide-y divide-border md:hidden">
            {data.rows.map((row) => (
              <li key={`${row.kind}:${row.id}`} className="px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-words text-ink">{row.label}</div>
                    {row.kind === "pt" && <PrivateChip row={row} className="mt-1 inline-block" />}
                  </div>
                  <PayCell pay={row.instructor_pay_sgd} className="shrink-0" />
                </div>
                <div className="mt-1 text-xs text-muted">
                  {formatDate(row.starts_at)} · <RowDuration row={row} />
                </div>
              </li>
            ))}
          </ul>
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-3 py-2.5 font-medium">Class taught</th>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Duration</th>
                <th className="px-3 py-2.5 text-right font-medium">Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((row) => (
                <tr key={`${row.kind}:${row.id}`} className="hover:bg-warm/40">
                  <td className="px-3 py-2.5">
                    <span className="text-ink">{row.label}</span>
                    {row.kind === "pt" && <PrivateChip row={row} className="ml-2" />}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{formatDate(row.starts_at)}</td>
                  <td className="px-3 py-2.5 text-muted">
                    <RowDuration row={row} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <PayCell pay={row.instructor_pay_sgd} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PrivateChip({ row, className }: { row: ApiPayrollRow; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent",
        className,
      )}
    >
      Private · {row.session_type === "2on1" ? "2-on-1" : "1-on-1"}
    </span>
  );
}

/** A workshop's "duration" is its whole span of dates, not a length of time. */
function RowDuration({ row }: { row: ApiPayrollRow }) {
  return (
    <>
      {row.kind === "workshop"
        ? `${formatDate(row.starts_at)} – ${formatDate(row.ends_at)}`
        : formatDuration(row.starts_at, row.ends_at)}
    </>
  );
}

function PayCell({ pay, className }: { pay: number | null; className?: string }) {
  return (
    <span className={cn("tabular-nums", pay == null ? "text-muted" : "text-ink", className)}>
      {pay == null ? "—" : formatSgd(pay)}
    </span>
  );
}
