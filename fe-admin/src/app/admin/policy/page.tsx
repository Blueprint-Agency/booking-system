"use client";
import { useState } from "react";
import { Save, Info } from "lucide-react";
import { Button, Input, Label, PageHeader } from "@/components/ui";
import { globalPolicy as seedPolicy } from "@/data";
import { formatRelative } from "@/lib/formatters";
import type { GlobalPolicy } from "@/types";

export default function PolicyPage() {
  const [policy, setPolicy] = useState<GlobalPolicy>(seedPolicy);
  const [draft, setDraft] = useState<GlobalPolicy>(seedPolicy);
  const dirty =
    draft.cancelCapCount !== policy.cancelCapCount ||
    draft.cancelCapCycleDays !== policy.cancelCapCycleDays ||
    draft.classWindowHours !== policy.classWindowHours ||
    draft.ptWindowHours !== policy.ptWindowHours;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setPolicy({ ...draft, updatedAt: new Date().toISOString() });
    alert("Policy updated (mock).");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Global Policy"
        description="Single source of truth for client-initiated class and PT cancellation. Workshops are non-refundable; package purchases are non-cancellable."
      />

      <form onSubmit={handleSave} className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-6 shadow-soft">
          <header className="mb-4">
            <h2 className="text-base font-semibold text-ink">Cancellation cap</h2>
            <p className="mt-0.5 text-xs text-muted">
              How many cancellations a client gets per cycle. Applies universally — no per-client overrides. Counts class + PT together.
            </p>
          </header>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cap-count">Max cancellations</Label>
              <Input
                id="cap-count"
                type="number"
                min={0}
                value={draft.cancelCapCount}
                onChange={(e) =>
                  setDraft({ ...draft, cancelCapCount: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cap-cycle">Cycle (days)</Label>
              <Input
                id="cap-cycle"
                type="number"
                min={1}
                value={draft.cancelCapCycleDays}
                onChange={(e) =>
                  setDraft({ ...draft, cancelCapCycleDays: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <p className="mt-3 inline-flex items-start gap-1.5 text-xs text-muted">
            <Info className="mt-0.5 h-3 w-3" />
            Currently:{" "}
            <span className="font-medium text-ink">
              {draft.cancelCapCount} cancellations per {draft.cancelCapCycleDays} days
            </span>
            . No-shows do not count toward this cap.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-6 shadow-soft">
          <header className="mb-4">
            <h2 className="text-base font-semibold text-ink">Cancellation windows</h2>
            <p className="mt-0.5 text-xs text-muted">
              How far in advance clients must cancel for a refund. Cancellation itself is always allowed; the window only gates whether credits/sessions are returned.
            </p>
          </header>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="class-window">Class window (hours)</Label>
              <Input
                id="class-window"
                type="number"
                min={0}
                value={draft.classWindowHours}
                onChange={(e) =>
                  setDraft({ ...draft, classWindowHours: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pt-window">PT window (hours)</Label>
              <Input
                id="pt-window"
                type="number"
                min={0}
                value={draft.ptWindowHours}
                onChange={(e) =>
                  setDraft({ ...draft, ptWindowHours: Number(e.target.value) })
                }
              />
            </div>
          </div>
        </section>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">
            Last updated {formatRelative(policy.updatedAt)}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={!dirty}
              onClick={() => setDraft(policy)}
            >
              Reset
            </Button>
            <Button type="submit" disabled={!dirty}>
              <Save className="h-4 w-4" /> Save policy
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
