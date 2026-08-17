"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Download, Loader2, Plus, Trash2 } from "lucide-react";
import {
  EmptyState,
  PageHeader,
  Button,
  Dialog,
  DialogFooter,
  Input,
  Label,
  Select,
} from "@/components/ui";
import {
  DateRangeFilter,
  presetRange,
  type DateRange,
} from "@/components/date-range-filter";
import { useWorkspace } from "@/lib/workspace-context";
import type { Api } from "@/lib/api";
import {
  fetchActiveInstructors,
  fetchActiveLocations,
  type CatalogInstructor,
  type CatalogLocation,
} from "@/lib/catalog";
import { formatDate, formatSgd, formatTime } from "@/lib/formatters";
import { localDay } from "@/lib/local-day";
import { toast } from "sonner";
import {
  FINANCE_TYPE_LABEL,
  FINANCE_TYPES,
  UNATTRIBUTED,
  createManualEntry,
  deleteManualEntry,
  downloadFinanceCsv,
  fetchFinance,
  fetchFinanceOverview,
  financeErrorMessage,
  financeNeedsReload,
  saveInstructorPay,
  type FinanceFilters,
  type FinanceOverview,
  type FinanceResponse,
  type FinanceRow,
} from "@/lib/finance";
import { OverviewPanel } from "./overview";

/**
 * Finance — every transaction in a period, money in and money out.
 *
 * The page reads top-down as one period: the period control sits with the
 * overview at the top and drives BOTH halves, and the filters below it narrow
 * only the ledger. That split is the point — a headline figure that moved
 * because of a filter the reader has already scrolled past is a lie, so the
 * narrowing controls are downstream of the figures they cannot change.
 *
 * The ledger is a general transaction list, not a payroll sheet: one row per
 * transaction, with the person on one side (member OR instructor) and what they
 * transacted on the other (type, then which one of it). Instructor Pay is one
 * type among many rather than the shape of the whole table.
 *
 * Two things this screen must never do, both of which it would be easy to do by
 * accident:
 *
 *   1. Total anything. Every figure comes from the backend and covers the whole
 *      period; the table is paginated, and page totals would quietly answer a
 *      different question than the one the admin asked.
 *   2. Decide which rows are editable. `row.editable` says so. A purchase or a
 *      Refund is the payment provider's record, and an edit box on one would be
 *      an invitation to make our books disagree with theirs.
 */

const PAGE_SIZE = 50;

export default function FinancePage() {
  const { api } = useWorkspace();

  const [instructors, setInstructors] = useState<CatalogInstructor[]>([]);
  const [locations, setLocations] = useState<CatalogLocation[]>([]);

  // The period is shared by both halves of the page; everything else narrows
  // the ledger alone.
  const [range, setRange] = useState<DateRange>(() => presetRange("month"));
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [needsPay, setNeedsPay] = useState(false);

  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [data, setData] = useState<FinanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  // Local draft values for the inline-editable amount cells.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filters: FinanceFilters = useMemo(
    () => ({ type, q, location, needsPay, range }),
    [type, q, location, needsPay, range],
  );

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const [ins, loc] = await Promise.all([
          fetchActiveInstructors(api),
          fetchActiveLocations(api),
        ]);
        if (cancelled) return;
        setInstructors(ins);
        setLocations(loc);
      } catch {
        /* filters degrade gracefully — the table still loads */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // The overview reloads on the period alone. Kept separate from the ledger's
  // effect so typing in the search box doesn't re-run four analytics queries.
  const loadOverview = useCallback(async () => {
    if (!api) return;
    setOverview(null);
    try {
      setOverview(await fetchFinanceOverview(api, range));
    } catch {
      /* the ledger below is the load-bearing half; it reports its own errors */
    }
  }, [api, range]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    // Drop the old period's rows before asking for the new one's.
    setData(null);
    try {
      setData(await fetchFinance(api, filters));
      setDrafts({});
    } catch (err) {
      setError(financeErrorMessage(err, "Couldn't load finance"));
    } finally {
      setLoading(false);
    }
  }, [api, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  // A filter change that shrinks the result set must not leave the reader
  // stranded on a page that no longer exists.
  useEffect(() => {
    setPage(0);
  }, [filters]);

  /** Both halves read the same period, so a write has to refresh both. */
  const reload = useCallback(async () => {
    await Promise.all([load(), loadOverview()]);
  }, [load, loadOverview]);

  const rows = data?.rows ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const rowKey = (r: FinanceRow) => `${r.kind}:${r.id}:${r.instructor_id ?? ""}`;

  async function saveAmount(row: FinanceRow) {
    if (!api) return;
    const key = rowKey(row);
    const raw = drafts[key];
    if (raw === undefined) return; // untouched
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (Number.isNaN(next) || next < 0)) {
      toast.error("Enter a valid amount.");
      return;
    }
    if (next === (row.pay_sgd ?? null)) {
      setDrafts((d) => {
        const { [key]: _, ...rest } = d;
        return rest;
      });
      return;
    }
    setSavingKey(key);
    try {
      await saveInstructorPay(api, row, next);
      toast.success("Pay updated");
      await reload();
    } catch (err) {
      toast.error(financeErrorMessage(err));
      // The session or the assignment is gone: reload so the stale row (and the
      // draft still sitting in its box, looking saved) is replaced by the truth.
      if (financeNeedsReload(err)) await reload();
    } finally {
      setSavingKey(null);
    }
  }

  async function handleDeleteManual(row: FinanceRow) {
    if (!api) return;
    if (!window.confirm("Delete this entry? This cannot be undone.")) return;
    setDeletingId(row.id);
    try {
      await deleteManualEntry(api, row.id);
      toast.success("Entry deleted");
      await reload();
    } catch (err) {
      toast.error(financeErrorMessage(err, "Couldn't delete"));
      if (financeNeedsReload(err)) await reload();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleExport() {
    if (!api) return;
    setExporting(true);
    try {
      await downloadFinanceCsv(api, filters);
    } catch (err) {
      toast.error(financeErrorMessage(err, "Couldn't export"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Finance"
        description="Every transaction for the period — purchases, refunds and instructor pay. Pay rows are editable inline; purchases and refunds are the payment record and can't be changed here."
        actions={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={exporting || rows.length === 0}
              onClick={() => void handleExport()}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}{" "}
              Export CSV
            </Button>
            <Button type="button" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> Add entry
            </Button>
          </div>
        }
      />

      {/* The period. Drives the overview AND the ledger, so it sits above both
          rather than inside either. */}
      <div className="mb-4 rounded-xl border border-border bg-card p-3 shadow-soft">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {overview ? (
        <OverviewPanel data={overview} unpricedCount={overview.unpriced_count} />
      ) : (
        <div className="flex items-center justify-center py-10 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      <h2 className="mt-8 mb-2 text-sm font-semibold text-ink">Transactions</h2>

      {/* Filters — these narrow the table only, never the figures above. */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3 shadow-soft">
        <div className="space-y-1.5">
          <label htmlFor="fin-user" className="block text-xs font-medium text-muted">
            User
          </label>
          {/* One box for members and instructors both: which side of the studio
              a name is on is what the Type column says, and needing to know it
              before you can search is the instructor-shaped assumption this
              screen is getting rid of. */}
          <input
            id="fin-user"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Customer or instructor…"
            className="h-9 min-w-[12rem] rounded-lg border border-border bg-paper px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <FilterSelect
          label="Type"
          value={type}
          onChange={setType}
          allLabel="All types"
          options={FINANCE_TYPES.map((t) => ({ val: t, label: FINANCE_TYPE_LABEL[t] }))}
        />
        <FilterSelect
          label="Location"
          value={location}
          onChange={setLocation}
          allLabel="All locations"
          options={[
            ...locations.map((l) => ({ val: l.id, label: l.name })),
            // Not a null hole: most purchases record no Location at all, and
            // the bucket is how that stays visible instead of vanishing.
            { val: UNATTRIBUTED, label: "Unattributed" },
          ]}
        />
        <label className="flex h-9 items-center gap-2 text-xs font-medium text-muted">
          <input
            type="checkbox"
            checked={needsPay}
            onChange={(e) => setNeedsPay(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Needs pay only
        </label>
      </div>

      {data && data.unpriced_count > 0 && !needsPay && (
        <button
          type="button"
          onClick={() => setNeedsPay(true)}
          className="mb-4 flex w-full items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-left text-xs text-warning hover:bg-warning/20"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {data.unpriced_count} completed{" "}
          {data.unpriced_count === 1 ? "session has" : "sessions have"} no pay set —
          Net excludes them. Show only those.
        </button>
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
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing in this period"
          description="Purchases, refunds and completed sessions appear here."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-soft">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-3 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Time</th>
                  <th className="px-3 py-2.5 font-medium">User</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Variant</th>
                  <th className="px-3 py-2.5 text-right font-medium">Price</th>
                  <th className="px-3 py-2.5 font-medium">Location</th>
                  <th className="px-3 py-2.5 text-right font-medium">Discount</th>
                  <th className="px-3 py-2.5 font-medium">Code</th>
                  <th className="px-3 py-2.5 text-right font-medium">Money in</th>
                  <th className="px-3 py-2.5 text-right font-medium">Money out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((row) => {
                  const key = rowKey(row);
                  const draft =
                    drafts[key] ?? (row.pay_sgd == null ? "" : String(row.pay_sgd));
                  return (
                    <tr key={key} className="hover:bg-warm/40">
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted">
                        {formatDate(row.occurred_at)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted">
                        {formatTime(row.occurred_at)}
                      </td>
                      <td className="px-3 py-2.5 text-ink">
                        {row.user_name ?? <span className="text-muted">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <TypeTag row={row} />
                        {row.refunded && row.kind !== "refund" && (
                          <span className="ml-1.5 rounded-full border border-error/40 bg-error/10 px-1.5 py-0.5 text-[10px] text-error">
                            Refunded
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-ink">
                        {row.variant ?? <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                        {row.list_price_sgd == null ? "—" : formatSgd(row.list_price_sgd)}
                      </td>
                      <td className="px-3 py-2.5 text-muted">
                        {row.unattributed ? (
                          <span className="text-muted/60">Unattributed</span>
                        ) : (
                          row.location_name
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {row.discount_sgd == null || row.discount_sgd === 0 ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span className="text-accent">
                            −{formatSgd(row.discount_sgd)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {row.promo_code ? (
                          <span className="rounded border border-border bg-paper px-1.5 py-0.5 text-[10px] text-ink">
                            {row.promo_code}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {row.paid_sgd == null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span className={row.paid_sgd < 0 ? "text-error" : "text-ink"}>
                            {formatSgd(row.paid_sgd)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {row.editable ? (
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
                                aria-label={`Pay for ${row.variant ?? FINANCE_TYPE_LABEL[row.type]}${
                                  row.user_name ? ` — ${row.user_name}` : ""
                                }`}
                                value={draft}
                                onChange={(e) =>
                                  setDrafts((d) => ({ ...d, [key]: e.target.value }))
                                }
                                onBlur={() => void saveAmount(row)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") e.currentTarget.blur();
                                }}
                                className={`h-9 w-28 rounded-lg border py-1 pl-7 pr-2 text-right text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                                  row.unpriced
                                    ? "border-warning/50 bg-warning/10"
                                    : "border-border bg-paper"
                                }`}
                              />
                            </div>
                            {row.kind === "manual" && (
                              <button
                                type="button"
                                aria-label="Delete entry"
                                disabled={deletingId === row.id}
                                onClick={() => void handleDeleteManual(row)}
                                className="rounded-md p-1.5 text-muted hover:bg-error/10 hover:text-error disabled:opacity-50"
                              >
                                {deletingId === row.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="mt-3 flex items-center justify-between text-xs text-muted">
              <span>
                {page * PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * PAGE_SIZE)} of{" "}
                {rows.length}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {showCreate && (
        <ManualEntryDialog
          api={api}
          instructors={instructors}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * The Type cell. A PT Session says which shape it was, because 1-on-1 and 2-on-1
 * cost the studio different amounts and reading them as one line hides that.
 */
function TypeTag({ row }: { row: FinanceRow }) {
  const label =
    row.type === "pt_session" && row.session_type
      ? `PT Session · ${row.session_type === "2on1" ? "2-on-1" : "1-on-1"}`
      : FINANCE_TYPE_LABEL[row.type];
  const danger = row.type === "refund";
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
        danger
          ? "border-error/40 bg-error/10 text-error"
          : "border-accent/40 bg-accent/10 text-accent"
      }`}
    >
      {label}
    </span>
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
        className="h-9 min-w-[10rem] rounded-lg border border-border bg-paper px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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

function ManualEntryDialog({
  api,
  instructors,
  onClose,
  onCreated,
}: {
  api: Api | null;
  instructors: CatalogInstructor[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [instructorId, setInstructorId] = useState("");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(() => localDay());
  const [saving, setSaving] = useState(false);

  const amountNum = Number(amount);
  const valid =
    instructorId !== "" &&
    amount.trim() !== "" &&
    !Number.isNaN(amountNum) &&
    amountNum >= 0 &&
    label.trim() !== "" &&
    date !== "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!api || !valid) return;
    setSaving(true);
    try {
      await createManualEntry(api, {
        instructorId,
        amountSgd: amountNum,
        label: label.trim(),
        day: date,
      });
      toast.success("Entry created");
      await onCreated();
    } catch (err) {
      toast.error(financeErrorMessage(err, "Couldn't create"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add pay entry">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="me-instructor">Instructor</Label>
          <Select
            id="me-instructor"
            required
            value={instructorId}
            onChange={(e) => setInstructorId(e.target.value)}
          >
            <option value="">Select instructor…</option>
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="me-amount">Amount (S$)</Label>
          <Input
            id="me-amount"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="me-label">Label</Label>
          <Input
            id="me-label"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Cover for Jane, Jan workshop bonus"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="me-date">Date</Label>
          <Input
            id="me-date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || saving}>
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
