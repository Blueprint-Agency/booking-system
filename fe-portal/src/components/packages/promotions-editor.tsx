"use client";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Button, Label } from "@/components/ui";
import { todayIso } from "@/lib/formatters";
import { localDay, localDayRange } from "@/lib/local-day";
import { overlappingPromotionIds } from "@/lib/promotions";
import type { Promotion, PromotionMode } from "@/types";

const QUICK_PERCENTS = [10, 25, 50];

// A promotion runs for whole local days: from local midnight on its first day
// through the last instant of its last day.
const startsOn = (day: string) => localDayRange(day).start.toISOString();
const endsOn = (day: string) => localDayRange(day).end.toISOString();

export function PromotionsEditor({
  basePriceSgd,
  value,
  onChange,
}: {
  basePriceSgd: number;
  value: Promotion[];
  onChange: (next: Promotion[]) => void;
}) {
  function add() {
    const today = new Date();
    const start = localDay(today);
    const end = localDay(new Date(today.getTime() + 14 * 86400_000));
    onChange([
      ...value,
      {
        id: `promo-${Date.now().toString(36)}`,
        label: "",
        mode: "percent",
        percent: 10,
        priceSgd: null,
        startsAt: startsOn(start),
        endsAt: endsOn(end),
      },
    ]);
  }
  function update(id: string, patch: Partial<Promotion>) {
    onChange(value.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function remove(id: string) {
    onChange(value.filter((p) => p.id !== id));
  }
  function preview(p: Promotion): number {
    if (p.mode === "percent" && p.percent !== null)
      return Math.round(basePriceSgd * (1 - p.percent / 100));
    if (p.mode === "price" && p.priceSgd !== null) return p.priceSgd;
    return basePriceSgd;
  }

  const conflicts = overlappingPromotionIds(value);

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">Promotions</div>
      {value.length === 0 && (
        <div className="text-xs text-muted">No promotions.</div>
      )}
      {conflicts.size > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Two or more promotions overlap in time. Each day can have at most one active
            promotion — adjust the highlighted date ranges so they don&apos;t overlap.
          </span>
        </div>
      )}
      {value.map((p) => (
        <div
          key={p.id}
          className={`space-y-3 rounded-lg border bg-paper p-3 ${
            conflicts.has(p.id) ? "border-error/60" : "border-border"
          }`}
        >
          <div className="flex gap-2">
            <input
              value={p.label}
              onChange={(e) => update(p.id, { label: e.target.value })}
              placeholder="e.g. CNY Promo"
              className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => remove(p.id)}
              className="rounded p-2 text-muted hover:text-error"
              aria-label="Remove promotion"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="flex gap-2">
            {(["percent", "price"] as PromotionMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() =>
                  update(p.id, {
                    mode: m,
                    percent: m === "percent" ? (p.percent ?? 10) : null,
                    priceSgd: m === "price" ? (p.priceSgd ?? 0) : null,
                  })
                }
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  p.mode === m
                    ? "border-accent bg-accent/10 text-ink"
                    : "border-border bg-card text-muted"
                }`}
              >
                {m === "percent" ? "Percentage" : "Special price"}
              </button>
            ))}
          </div>
          {p.mode === "percent" ? (
            <div className="flex flex-wrap items-center gap-2">
              {QUICK_PERCENTS.map((qp) => (
                <button
                  key={qp}
                  type="button"
                  onClick={() => update(p.id, { percent: qp })}
                  className="rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:border-accent/40"
                >
                  {qp}%
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={99}
                value={p.percent ?? 0}
                onChange={(e) =>
                  update(p.id, {
                    percent: Math.max(1, Math.min(99, Number(e.target.value) || 0)),
                  })
                }
                className="w-20 rounded-md border border-border bg-card px-2 py-1 text-sm"
              />
              <span className="text-xs text-muted">%</span>
            </div>
          ) : (
            <input
              type="number"
              min={0}
              value={p.priceSgd ?? 0}
              onChange={(e) =>
                update(p.id, { priceSgd: Math.max(0, Number(e.target.value) || 0) })
              }
              placeholder="Special price SGD"
              className="w-40 rounded-md border border-border bg-card px-3 py-2 text-sm"
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Starts</Label>
              <input
                type="date"
                min={todayIso()}
                value={localDay(p.startsAt)}
                onChange={(e) => {
                  const start = e.target.value;
                  if (!start) return; // cleared field — keep the last valid day
                  const patch: Partial<Promotion> = { startsAt: startsOn(start) };
                  // Keep end on/after start.
                  if (localDay(p.endsAt) < start) patch.endsAt = endsOn(start);
                  update(p.id, patch);
                }}
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ends</Label>
              <input
                type="date"
                min={localDay(p.startsAt) || todayIso()}
                value={localDay(p.endsAt)}
                onChange={(e) =>
                  e.target.value && update(p.id, { endsAt: endsOn(e.target.value) })
                }
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div className="text-xs text-muted">
            S${basePriceSgd} → <span className="font-semibold text-ink">S${preview(p)}</span>
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add promotion
      </Button>
    </div>
  );
}
