"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, Wallet } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { formatDate, formatDuration, formatSgd } from "@/lib/formatters";
import type { ApiPayrollRow } from "@/lib/payroll";

interface InstructorPayrollResponse {
  rows: ApiPayrollRow[];
  total_sgd: number;
  session_count: number;
  unpriced_count: number;
}

/** "2026-06" → [first instant of the month, last instant], as ISO strings. */
function monthRange(month: string): { from: string; to: string } | null {
  if (!month) return null;
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return null;
  const from = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const to = new Date(y, m, 0, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function InstructorPayrollPage() {
  const { api } = useWorkspace();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<InstructorPayrollResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const range = monthRange(month);
      const res = await api.get<InstructorPayrollResponse>(
        "/portal/instructor/payroll",
        { from: range?.from, to: range?.to },
      );
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api, month]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="My payroll"
        description="Your completed classes and private sessions, and the pay recorded for each. Amounts are set by an admin."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-10 rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        {month && (
          <button
            type="button"
            onClick={() => setMonth("")}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm text-muted hover:text-ink"
          >
            All time
          </button>
        )}
      </div>

      {data && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-soft">
          <div className="flex items-center justify-between gap-3">
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
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {data.unpriced_count}{" "}
          {data.unpriced_count === 1 ? "session has" : "sessions have"} no pay set
          yet — the total excludes them until an admin fills them in.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          Failed to load payroll: {error}
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
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-soft">
          <table className="w-full text-sm">
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
                    {row.kind === "pt" && (
                      <span className="ml-2 rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                        Private · {row.session_type === "2on1" ? "2-on-1" : "1-on-1"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{formatDate(row.starts_at)}</td>
                  <td className="px-3 py-2.5 text-muted">
                    {formatDuration(row.starts_at, row.ends_at)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {row.instructor_pay_sgd == null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className="text-ink">{formatSgd(row.instructor_pay_sgd)}</span>
                    )}
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
