"use client";

/**
 * The Finance overview — the period's figures, above the ledger's filters.
 *
 * It reads a PERIOD and nothing else. The filters below it narrow the table,
 * never these numbers: a reader who has scrolled past a filter row has no way
 * to know a headline figure moved because of it, so the figures don't move.
 *
 * Nothing here adds anything up. Every number arrives computed from one backend
 * read (be/src/services/finance/overview.ts), which regroups the same rows the
 * table shows — so a category breakdown can't disagree with the Gross tile
 * sitting above it.
 */

import { useState } from "react";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatSgd } from "@/lib/formatters";
import {
  SALE_CATEGORY_LABEL,
  type ClassPopularity,
  type FinanceOverview,
  type SaleCategory,
} from "@/lib/finance";

/**
 * One colour per sale category, kept here rather than in the theme because
 * nothing outside this file speaks in categories. Ordered core business →
 * periphery along the two brand accents (indigo, then cyan) before the two warm
 * semantics, so the studio's main line of business is also the most saturated
 * mark on the page.
 *
 * Colour never carries a value alone — every slice has its label and its figure
 * beside its swatch in the legend, which is also the only way the reader gets
 * the exact number out of a ring.
 */
const CATEGORY_COLOR: Record<SaleCategory, string> = {
  classes: "#1a2a7a",
  pt: "#3a9fc2",
  workshops: "#5fbfd9",
  corporate: "#5b7a68",
  merch: "#c99a3a",
};

export function OverviewPanel({
  data,
  unpricedCount,
}: {
  data: FinanceOverview;
  /** Sessions with no pay set — Net excludes them, so Net must say so. */
  unpricedCount: number;
}) {
  const { members } = data;
  return (
    <div className="space-y-4">
      <MoneyChain data={data} unpricedCount={unpricedCount} />

      <div className="grid gap-4 lg:grid-cols-2">
        <SalesByCategory data={data} />
        {/* The member counts ride above By instructor rather than trailing the
            money row, where they left a ragged half-empty grid line next to a
            tall mostly-empty panel. */}
        <div className="grid content-start gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Tile
              label="Active members"
              value={String(members.active)}
              // Said out loud because it is the one figure here that does not
              // move with the period — it is a stock read today, not a flow
              // measured over the window. A reader scanning a row of period
              // figures will otherwise take it for one.
              hint="Holding a live package today — not period-scoped"
            />
            <Tile
              label="Joined"
              value={String(members.joined)}
              hint="New members in the period"
            />
          </div>
          <ByInstructor data={data} />
        </div>
      </div>

      <ClassPopularityPanel rows={data.classes} />
    </div>
  );
}

/* ------------------------------- Money chain ------------------------------- */

/**
 * The five money totals, laid out as the sum they actually are: gross, less each
 * deduction, equals Net. As five peer tiles in a four-across grid they ragged
 * the row and hid the arithmetic — nothing said the last tile was made out of
 * the other four.
 *
 * Each deduction carries its minus sign in the figure itself, so the sum still
 * reads on a narrow screen, where the row stacks and position can no longer say
 * which side of the equals a number sits on.
 */
function MoneyChain({
  data,
  unpricedCount,
}: {
  data: FinanceOverview;
  unpricedCount: number;
}) {
  const { totals } = data;
  const terms = [
    { label: "Gross sales", value: formatSgd(totals.gross_sgd) },
    { label: "Discounts", value: deduction(totals.discounts_sgd) },
    { label: "Refunds", value: deduction(totals.refunds_sgd) },
    { label: "Instructor pay", value: deduction(totals.instructor_pay_sgd) },
  ];
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      <div className="grid sm:grid-cols-2 lg:grid-cols-5">
        {terms.map((t) => (
          <div
            key={t.label}
            className="border-b border-border px-4 py-3 sm:border-r lg:border-b-0"
          >
            <div className="text-xs text-muted">{t.label}</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
              {t.value}
            </div>
          </div>
        ))}
        <div className="bg-accent/5 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-accent">
            Net
          </div>
          <div className="mt-0.5 text-2xl font-bold tabular-nums text-accent">
            {formatSgd(totals.net_sgd)}
          </div>
          {unpricedCount > 0 && (
            <div className="mt-1 flex items-start gap-1 text-[10px] leading-tight text-warning">
              <AlertCircle className="mt-px h-3 w-3 shrink-0" />
              Excludes {unpricedCount} unpriced{" "}
              {unpricedCount === 1 ? "session" : "sessions"}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** A zero deduction stays plain — "−$0" reads like a debt that isn't one. */
function deduction(amount: number): string {
  return amount === 0 ? formatSgd(0) : `−${formatSgd(amount)}`;
}

/* --------------------------------- Tiles ---------------------------------- */

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-soft">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] leading-tight text-muted">{hint}</div>}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-soft">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** An empty panel used to read as one grey line stranded at the top of a box. */
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex min-h-24 items-center justify-center rounded-lg bg-warm/50 px-4 text-center text-xs text-muted">
      {children}
    </p>
  );
}

/* ---------------------------- Sales by category ---------------------------- */

/**
 * A ring, not bars. The question this panel answers is "what is the studio
 * actually selling" — a share-of-the-whole question, and the categories sum to
 * Gross exactly, which is the one condition under which a ring is honest. Bars
 * of one length each answered the wrong question and, at these amounts, drew
 * four invisible ones.
 */
const RING_R = 44;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Categories laid end to end around the ring, each arc starting where the last
 * one stopped. Only the ones that sold get an arc — a zero-length arc still
 * paints a mark on the ring, which reads as a sale that didn't happen.
 */
function toArcs(rows: FinanceOverview["sales_by_category"], total: number) {
  const sold = rows.filter((r) => r.gross_sgd > 0);
  let offset = 0;
  return sold.map((row) => {
    const length = (row.gross_sgd / total) * RING_C;
    const arc = { row, length, offset };
    offset += length;
    return arc;
  });
}

function SalesByCategory({ data }: { data: FinanceOverview }) {
  const rows = data.sales_by_category;
  const [hovered, setHovered] = useState<SaleCategory | null>(null);
  const total = rows.reduce((sum, r) => sum + r.gross_sgd, 0);

  const arcs = toArcs(rows, total);

  return (
    <Panel title="What sold" subtitle="Gross by category — sums to Gross sales.">
      {total === 0 ? (
        <Empty>Nothing sold in this period.</Empty>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="relative shrink-0">
            <svg viewBox="0 0 120 120" className="h-32 w-32" role="presentation">
              <circle
                cx="60"
                cy="60"
                r={RING_R}
                fill="none"
                stroke="var(--color-warm)"
                strokeWidth="16"
              />
              {arcs.map(({ row, length, offset: start }) => (
                <circle
                  key={row.category}
                  cx="60"
                  cy="60"
                  r={RING_R}
                  fill="none"
                  stroke={CATEGORY_COLOR[row.category]}
                  strokeWidth={hovered === row.category ? 20 : 16}
                  strokeDasharray={`${length} ${RING_C - length}`}
                  strokeDashoffset={-start}
                  // Start at twelve o'clock: a ring read from the right-hand
                  // side is a ring nobody reads in the order it was drawn.
                  transform="rotate(-90 60 60)"
                  className="transition-all duration-150"
                  opacity={hovered && hovered !== row.category ? 0.35 : 1}
                />
              ))}
            </svg>
            {/* The centre holds the figure the ring is a breakdown of, so the
                whole and its parts never have to be looked up apart. */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-base font-bold tabular-nums text-ink">
                {formatSgd(total)}
              </span>
              <span className="text-[10px] text-muted">gross</span>
            </div>
          </div>

          <ul className="w-full flex-1 space-y-1">
            {rows.map((r) => {
              const sold = r.gross_sgd > 0;
              return (
                <li
                  key={r.category}
                  onMouseEnter={() => setHovered(r.category)}
                  onMouseLeave={() => setHovered(null)}
                  className={`flex items-baseline gap-2 rounded-md px-1.5 py-1 transition-colors ${
                    hovered === r.category ? "bg-warm/60" : ""
                  }`}
                >
                  <span
                    aria-hidden
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{
                      backgroundColor: sold ? CATEGORY_COLOR[r.category] : undefined,
                      border: sold ? undefined : "1px solid var(--color-border)",
                    }}
                  />
                  <span
                    className={`flex-1 truncate text-sm ${sold ? "text-ink" : "text-muted"}`}
                  >
                    {SALE_CATEGORY_LABEL[r.category]}
                  </span>
                  {/* A share is what the ring shows; the amount is what an owner
                      writes down. Both, or the ring is decoration. */}
                  {sold && (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">
                      {Math.round((r.gross_sgd / total) * 100)}%
                    </span>
                  )}
                  <span
                    className={`w-16 shrink-0 text-right text-sm tabular-nums ${
                      sold ? "font-medium text-ink" : "text-muted"
                    }`}
                  >
                    {formatSgd(r.gross_sgd)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Transaction counts and part-paid amounts are the footnotes to the ring,
          not competitors with it — one line, below, only where they say
          something. A "collected" figure equal to gross on every row is noise
          that hides the rows where it isn't. */}
      {total > 0 && (
        <p className="mt-3 border-t border-border pt-2 text-[11px] leading-relaxed text-muted">
          {rows
            .filter((r) => r.count > 0)
            .map(
              (r) =>
                `${SALE_CATEGORY_LABEL[r.category]} ${r.count}${
                  r.collected_sgd !== r.gross_sgd
                    ? ` (${formatSgd(r.collected_sgd)} collected)`
                    : ""
                }`,
            )
            .join(" · ")}{" "}
          — transactions in the period.
        </p>
      )}
    </Panel>
  );
}

/* ------------------------------ By instructor ------------------------------ */

function ByInstructor({ data }: { data: FinanceOverview }) {
  const rows = data.by_instructor;
  const max = Math.max(...rows.map((t) => t.total_sgd), 0);
  return (
    <Panel title="By instructor" subtitle="Pay owed for the period, and sessions taught.">
      {rows.length === 0 ? (
        <Empty>No priced sessions in this period.</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => (
            <li key={t.instructor_id} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm text-ink">
                {t.instructor_name}
              </span>
              {/* Pay is money out, so it is drawn in the warning tone the rest of
                  the page uses for money leaving, never in the sales indigo. */}
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-warm">
                <span
                  className="block h-full rounded-full bg-warning"
                  style={{ width: max > 0 ? `${(t.total_sgd / max) * 100}%` : "0%" }}
                />
              </span>
              <span className="shrink-0 text-[11px] text-muted">
                {t.session_count} {t.session_count === 1 ? "session" : "sessions"}
              </span>
              <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums text-ink">
                {formatSgd(t.total_sgd)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------------------------- Class popularity ----------------------------- */

function Trend({ row }: { row: ClassPopularity }) {
  if (row.previous == null) {
    return <span className="text-[11px] text-muted/60">—</span>;
  }
  const delta = row.attended - row.previous;
  if (delta === 0) {
    return (
      <span className="flex items-center gap-0.5 text-[11px] text-muted">
        <Minus className="h-3 w-3" /> level
      </span>
    );
  }
  const up = delta > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`flex items-center gap-0.5 text-[11px] tabular-nums ${
        up ? "text-sage" : "text-error"
      }`}
      title={`${row.previous} in the previous period of the same length`}
    >
      <Icon className="h-3 w-3" />
      {up ? "+" : ""}
      {delta}
    </span>
  );
}

/**
 * Bars are coloured by which way the class is moving, not by where it landed in
 * the sort. Colouring the last row warned about nothing — with two rows it
 * flagged the second-most-popular class — while a class that is shrinking is
 * worth a look wherever it sits in the order.
 */
function trendColor(row: ClassPopularity): string {
  if (row.previous == null) return "bg-accent";
  const delta = row.attended - row.previous;
  if (delta > 0) return "bg-sage";
  if (delta < 0) return "bg-warning";
  return "bg-accent";
}

function ClassPopularityPanel({ rows }: { rows: ClassPopularity[] }) {
  const max = Math.max(...rows.map((r) => r.attended), 0);
  return (
    <Panel
      title="Class popularity"
      subtitle="Attendances — check-ins, not bookings. Most popular first; the trend compares the period of the same length immediately before, and a bar is green where the class grew, amber where it shrank."
    >
      {rows.length === 0 ? (
        <Empty>No classes were attended in this period.</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.class_type_id} className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate text-sm text-ink" title={r.name}>
                {r.name}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-warm">
                <span
                  className={`block h-full rounded-full ${trendColor(r)}`}
                  style={{ width: max > 0 ? `${(r.attended / max) * 100}%` : "0%" }}
                />
              </span>
              <span className="w-10 shrink-0 text-right text-sm tabular-nums text-ink">
                {r.attended}
              </span>
              <span className="w-16 shrink-0">
                <Trend row={r} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
