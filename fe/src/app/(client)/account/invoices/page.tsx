"use client";

import { useMemo, useState } from "react";
import { FileX } from "lucide-react";
import { formatDate, formatCurrency, cn } from "@/lib/utils";
import { SectionHeading } from "@/components/booking/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { useMockState } from "@/lib/mock-state";

const PAGE_SIZE = 10;

type TypeFilter = "all" | "package" | "workshop";

export default function InvoicesPage() {
  const { invoices } = useMockState();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const inv of invoices) set.add(String(new Date(inv.issuedAt).getFullYear()));
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [invoices]);

  const filtered = useMemo(() => {
    const sorted = [...invoices].sort(
      (a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime()
    );
    return sorted.filter((inv) => {
      if (typeFilter !== "all" && inv.itemKind !== typeFilter) return false;
      if (yearFilter !== "all" && String(new Date(inv.issuedAt).getFullYear()) !== yearFilter) return false;
      return true;
    });
  }, [invoices, typeFilter, yearFilter]);

  const paged = filtered.slice(0, visible);
  const hasMore = filtered.length > visible;

  function updateFilter<T>(setter: (v: T) => void, value: T) {
    setter(value);
    setVisible(PAGE_SIZE);
  }

  return (
    <div>
      <SectionHeading
        eyebrow="Invoices"
        title="Payment records"
        description="Download receipts for your tax records."
      />

      {invoices.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-border bg-warm p-1">
            {(["all", "package", "workshop"] as const).map((t) => (
              <button
                key={t}
                onClick={() => updateFilter(setTypeFilter, t)}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap",
                  typeFilter === t ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink"
                )}
              >
                {t === "all" ? "All" : t === "package" ? "Packages" : "Workshops"}
              </button>
            ))}
          </div>

          {years.length > 1 && (
            <select
              value={yearFilter}
              onChange={(e) => updateFilter(setYearFilter, e.target.value)}
              className="min-h-[40px] rounded-lg border border-border bg-warm px-3 text-sm font-medium text-ink focus:outline-none focus:border-accent"
            >
              <option value="all">All years</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}

          <span className="text-xs text-muted ml-auto">
            {filtered.length} {filtered.length === 1 ? "invoice" : "invoices"}
          </span>
        </div>
      )}

      <div className="rounded-2xl bg-paper border border-ink/10 overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            icon={FileX}
            title={invoices.length === 0 ? "No invoices yet" : "No invoices match your filters"}
            description={
              invoices.length === 0
                ? "Receipts will appear here after your first payment."
                : "Try adjusting the filters above."
            }
          />
        ) : (
          <ul className="divide-y divide-ink/5">
            {paged.map((invoice) => (
              <li
                key={invoice.id}
                className="flex items-center justify-between px-6 py-4"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">
                    {invoice.itemName}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {invoice.id} · {formatDate(invoice.issuedAt)}
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <div className="text-sm font-semibold text-ink">
                      {formatCurrency(invoice.total)}
                    </div>
                    <div className="text-xs text-muted">
                      incl. {formatCurrency(invoice.tax)} GST
                    </div>
                  </div>
                  <button className="rounded-full border border-ink/10 px-4 py-2 text-xs font-medium hover:border-accent transition-colors">
                    Download PDF
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
            className="rounded-full border border-ink/10 px-5 py-2 text-sm font-medium hover:border-accent transition-colors"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
