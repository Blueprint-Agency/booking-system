"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { formatDate, formatDuration, formatSgd } from "@/lib/formatters";
import { toast } from "sonner";
import type {
  ApiPayrollResponse,
  ApiPayrollRow,
  ApiPayrollTotal,
  PayrollSortKey,
  SortDir,
} from "@/lib/payroll";

interface ApiInstructor {
  id: string;
  name: string;
  archived_at?: string | null;
}
interface ApiClassType {
  id: string;
  name: string;
  archived_at: string | null;
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

export default function PayrollPage() {
  const { api } = useWorkspace();

  const [instructors, setInstructors] = useState<ApiInstructor[]>([]);
  const [classTypes, setClassTypes] = useState<ApiClassType[]>([]);

  const [instructorId, setInstructorId] = useState("");
  const [classTypeId, setClassTypeId] = useState("");
  const [month, setMonth] = useState(currentMonth());

  const [data, setData] = useState<ApiPayrollResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<PayrollSortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Local draft values for the inline-editable amount cells, keyed `${kind}:${id}`.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Filter dropdown options.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const [ins, ct] = await Promise.all([
          api.get<{ instructors: ApiInstructor[] }>("/portal/admin/instructors"),
          api.get<{ class_types: ApiClassType[] }>("/portal/admin/class-types"),
        ]);
        if (cancelled) return;
        setInstructors(ins.instructors.filter((i) => !i.archived_at));
        setClassTypes(ct.class_types.filter((c) => !c.archived_at));
      } catch {
        /* filters degrade gracefully — the table still loads */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const range = monthRange(month);
      const res = await api.get<ApiPayrollResponse>("/portal/admin/payroll", {
        instructor_id: instructorId || undefined,
        class_type_id: classTypeId || undefined,
        from: range?.from,
        to: range?.to,
      });
      setData(res);
      setDrafts({});
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api, instructorId, classTypeId, month]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleSort(key: PayrollSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Sensible default direction per column.
      setSortDir(key === "date" || key === "amount" || key === "duration" ? "desc" : "asc");
    }
  }

  const sortedRows = useMemo(() => {
    const rows = data?.rows ? [...data.rows] : [];
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "instructor":
          cmp = a.instructor_name.localeCompare(b.instructor_name);
          break;
        case "label":
          cmp = a.label.localeCompare(b.label);
          break;
        case "date":
          cmp = a.starts_at.localeCompare(b.starts_at);
          break;
        case "duration":
          cmp = a.duration_minutes - b.duration_minutes;
          break;
        case "amount": {
          // Unpriced rows sort to the bottom regardless of direction.
          const av = a.instructor_pay_sgd;
          const bv = b.instructor_pay_sgd;
          if (av == null && bv == null) cmp = 0;
          else if (av == null) return 1;
          else if (bv == null) return -1;
          else cmp = av - bv;
          break;
        }
      }
      return cmp * dir;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  async function saveAmount(row: ApiPayrollRow) {
    if (!api) return;
    const key = `${row.kind}:${row.id}`;
    const raw = drafts[key];
    if (raw === undefined) return; // untouched
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (Number.isNaN(next) || next < 0)) {
      toast.error("Enter a valid amount.");
      return;
    }
    // No-op if unchanged.
    if (next === (row.instructor_pay_sgd ?? null)) {
      setDrafts((d) => {
        const { [key]: _, ...rest } = d;
        return rest;
      });
      return;
    }
    setSavingKey(key);
    try {
      await api.patch(`/portal/admin/payroll/${row.kind}/${row.id}`, {
        instructor_pay_sgd: next,
      });
      toast.success("Pay updated");
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? `Couldn't save (HTTP ${err.status})` : "Couldn't save",
      );
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Payroll"
        description="Completed classes and private sessions with the pay owed to each instructor. Fill in or adjust an amount inline — it saves to that session."
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FilterSelect
          label="Instructor"
          value={instructorId}
          onChange={setInstructorId}
          allLabel="All instructors"
          options={instructors.map((i) => ({ val: i.id, label: i.name }))}
        />
        <FilterSelect
          label="Class"
          value={classTypeId}
          onChange={setClassTypeId}
          allLabel="All classes"
          options={classTypes.map((c) => ({ val: c.id, label: c.name }))}
        />
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

      {/* Per-instructor totals */}
      {data && data.totals.length > 0 && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.totals.map((t: ApiPayrollTotal) => (
            <div
              key={t.instructor_id}
              className="rounded-xl border border-border bg-card p-3 shadow-soft"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-ink">{t.instructor_name}</span>
                <span className="text-sm font-semibold tabular-nums text-ink">
                  {formatSgd(t.total_sgd)}
                </span>
              </div>
              <div className="text-xs text-muted">
                {t.session_count} {t.session_count === 1 ? "session" : "sessions"}
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.unpriced_count > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {data.unpriced_count} completed{" "}
          {data.unpriced_count === 1 ? "session has" : "sessions have"} no pay set yet —
          totals exclude them.
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
      ) : sortedRows.length === 0 ? (
        <EmptyState
          title="No completed sessions"
          description="Classes and private sessions appear here once they've finished."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-soft">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <SortHeader label="Instructor" col="instructor" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeader label="Class taught" col="label" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeader label="Date" col="date" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeader label="Duration" col="duration" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeader label="Amount pay" col="amount" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedRows.map((row) => {
                const key = `${row.kind}:${row.id}`;
                const draft =
                  drafts[key] ??
                  (row.instructor_pay_sgd == null ? "" : String(row.instructor_pay_sgd));
                return (
                  <tr key={key} className="hover:bg-warm/40">
                    <td className="px-3 py-2.5 text-ink">{row.instructor_name}</td>
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
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {savingKey === key && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
                        )}
                        <div className="relative">
                          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
                            S$
                          </span>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            placeholder="—"
                            value={draft}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [key]: e.target.value }))
                            }
                            onBlur={() => void saveAmount(row)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            className="h-9 w-28 rounded-lg border border-border bg-paper py-1 pl-7 pr-2 text-right text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  col,
  sortKey,
  sortDir,
  onClick,
  align = "left",
}: {
  label: string;
  col: PayrollSortKey;
  sortKey: PayrollSortKey;
  sortDir: SortDir;
  onClick: (col: PayrollSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === col;
  return (
    <th className={`px-3 py-2.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onClick(col)}
        className={`inline-flex items-center gap-1 hover:text-ink ${
          active ? "text-ink" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: { val: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-muted">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 min-w-[10rem] rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.val} value={o.val}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
