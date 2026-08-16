"use client";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import type { WorkshopDay, WorkshopTier } from "@/types";
import { atLocalTime } from "@/lib/local-day";

export function WorkshopTiersEditor({
  workshopId,
  days,
  tiers,
  onChange,
}: {
  workshopId: string;
  days: WorkshopDay[];
  tiers: WorkshopTier[];
  onChange: (tiers: WorkshopTier[]) => void;
}) {
  if (days.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-paper p-4 text-sm text-muted">
        Add at least one day before creating pricing tiers.
      </div>
    );
  }

  function add() {
    onChange([
      ...tiers,
      {
        id: `wtier-${Date.now().toString(36)}`,
        workshopId,
        name: "",
        description: "",
        dayIds: days.map((d) => d.id),
        priceSgd: 0,
        earlyBirdPriceSgd: null,
        earlyBirdCutoffAt: null,
      },
    ]);
  }
  function update(id: string, patch: Partial<WorkshopTier>) {
    onChange(tiers.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  function remove(id: string) {
    onChange(tiers.filter((t) => t.id !== id));
  }
  function toggleDay(t: WorkshopTier, dayId: string) {
    const has = t.dayIds.includes(dayId);
    update(t.id, {
      dayIds: has ? t.dayIds.filter((d) => d !== dayId) : [...t.dayIds, dayId],
    });
  }
  function setAllDays(t: WorkshopTier) {
    update(t.id, { dayIds: days.map((d) => d.id) });
  }

  return (
    <div className="space-y-3">
      {tiers.length === 0 && (
        <p className="text-xs text-muted">No tiers yet. Add at least one.</p>
      )}
      {tiers.map((t) => {
        const ebInvalid =
          t.earlyBirdPriceSgd !== null && t.earlyBirdPriceSgd >= t.priceSgd;
        const ebCutoffMissing =
          t.earlyBirdPriceSgd !== null && !t.earlyBirdCutoffAt;
        return (
          <div key={t.id} className="space-y-3 rounded-lg border border-border bg-paper p-4">
            <div className="flex gap-2">
              <Input
                value={t.name}
                onChange={(e) => update(t.id, { name: e.target.value })}
                placeholder="e.g. Full Event Pass"
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => remove(t.id)}
                className="rounded p-2 text-muted hover:text-error"
                aria-label="Remove tier"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={t.description}
              onChange={(e) => update(t.id, { description: e.target.value })}
              rows={2}
              placeholder="One-line description shown on the customer purchase card."
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            />
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-xs">Days included</Label>
                <button
                  type="button"
                  onClick={() => setAllDays(t)}
                  className="text-xs text-accent hover:underline"
                >
                  All days
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {days.map((d, idx) => {
                  const checked = t.dayIds.includes(d.id);
                  return (
                    <label
                      key={d.id}
                      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition ${
                        checked
                          ? "border-accent bg-accent/10 text-ink"
                          : "border-border bg-card text-muted"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDay(t, d.id)}
                        className="h-3 w-3"
                      />
                      Day {idx + 1} ·{" "}
                      {atLocalTime(d.date, "00:00").toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                      })}
                    </label>
                  );
                })}
              </div>
              {t.dayIds.length === 0 && (
                <p className="mt-1 text-xs text-error">Tier needs at least one day.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tier price (SGD)</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="e.g. 180"
                  value={t.priceSgd === 0 ? "" : t.priceSgd}
                  onChange={(e) =>
                    update(t.id, { priceSgd: Math.max(0, Number(e.target.value) || 0) })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Early-bird price (optional)</Label>
                <Input
                  type="number"
                  min={0}
                  value={t.earlyBirdPriceSgd ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    update(t.id, {
                      earlyBirdPriceSgd: raw === "" ? null : Math.max(0, Number(raw) || 0),
                    });
                  }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Early-bird cutoff</Label>
              <Input
                type="datetime-local"
                value={
                  t.earlyBirdCutoffAt ? t.earlyBirdCutoffAt.slice(0, 16) : ""
                }
                disabled={t.earlyBirdPriceSgd === null}
                onChange={(e) =>
                  update(t.id, {
                    earlyBirdCutoffAt: e.target.value
                      ? `${e.target.value}:00.000Z`
                      : null,
                  })
                }
              />
            </div>
            {ebInvalid && (
              <p className="text-xs text-error">
                Early-bird price must be lower than the tier price.
              </p>
            )}
            {ebCutoffMissing && (
              <p className="text-xs text-error">
                Set an early-bird cutoff so the discount expires.
              </p>
            )}
          </div>
        );
      })}
      <Button type="button" size="sm" variant="ghost" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add tier
      </Button>
    </div>
  );
}
