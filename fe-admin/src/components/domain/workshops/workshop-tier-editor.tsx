"use client";

import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { newTier } from "@/lib/mutations/workshops";
import type { WorkshopTier } from "@/types";

export interface WorkshopTierEditorProps {
  tiers: WorkshopTier[];
  onChange: (tiers: WorkshopTier[]) => void;
}

export function WorkshopTierEditor({ tiers, onChange }: WorkshopTierEditorProps) {
  const update = (id: string, patch: Partial<WorkshopTier>) =>
    onChange(tiers.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const remove = (id: string) => onChange(tiers.filter((t) => t.id !== id));
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...tiers];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };
  const add = () => onChange([...tiers, { ...newTier(), label: `Tier ${tiers.length + 1}` }]);

  return (
    <div className="space-y-2">
      {tiers.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted">
          No tiers yet. Add your first one — Early Bird, Standard, Duo …
        </div>
      )}
      {tiers.map((tier, idx) => (
        <div
          key={tier.id}
          className="rounded-lg border border-border bg-card p-3"
        >
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 md:col-span-4">
              <Label htmlFor={`label-${tier.id}`}>Label</Label>
              <Input
                id={`label-${tier.id}`}
                value={tier.label}
                onChange={(e) => update(tier.id, { label: e.target.value })}
                placeholder="Early Bird"
              />
            </div>
            <div className="col-span-6 md:col-span-3">
              <Label htmlFor={`price-${tier.id}`}>Price (¢)</Label>
              <Input
                id={`price-${tier.id}`}
                type="number"
                min={0}
                value={tier.priceCents}
                onChange={(e) =>
                  update(tier.id, { priceCents: Number(e.target.value) || 0 })
                }
              />
            </div>
            <div className="col-span-6 md:col-span-3">
              <Label htmlFor={`cutoff-${tier.id}`}>Cutoff date</Label>
              <Input
                id={`cutoff-${tier.id}`}
                type="date"
                value={tier.cutoffDate ?? ""}
                onChange={(e) =>
                  update(tier.id, { cutoffDate: e.target.value || null })
                }
              />
            </div>
            <div className="col-span-12 md:col-span-2 flex items-end justify-end gap-1">
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                className="rounded p-1.5 text-muted hover:bg-paper hover:text-ink disabled:opacity-30"
                aria-label="Move up"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                disabled={idx === tiers.length - 1}
                className="rounded p-1.5 text-muted hover:bg-paper hover:text-ink disabled:opacity-30"
                aria-label="Move down"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => remove(tier.id)}
                className="rounded p-1.5 text-muted hover:bg-paper hover:text-error"
                aria-label="Remove tier"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={tier.active}
              onChange={(e) => update(tier.id, { active: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
            <span>Active (visible to clients)</span>
          </label>
        </div>
      ))}
      <Button type="button" variant="ghost" onClick={add}>
        <Plus className="mr-1 h-4 w-4" /> Add tier
      </Button>
    </div>
  );
}
