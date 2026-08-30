"use client";
// FIXTURE-BACKED: reads static mock data from `@/data`, not the live backend.
import { useState } from "react";
import { Save, FileCheck } from "lucide-react";
import { Button, Label, PageHeader } from "@/components/ui";
import { waiver as seedWaiver, clients } from "@/data";
import { formatRelative } from "@/lib/formatters";

export default function WaiverPage() {
  const [waiver, setWaiver] = useState(seedWaiver);
  const [draftHtml, setDraftHtml] = useState(seedWaiver.bodyHtml);
  const dirty = draftHtml !== waiver.bodyHtml;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setWaiver({ bodyHtml: draftHtml, updatedAt: new Date().toISOString() });
    alert(
      "Waiver updated (mock).\n\nExisting signed customers are NOT required to re-sign — their original acceptance timestamp stands."
    );
  }

  const signedCount = clients.length;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Waiver"
        description="Single studio-wide liability waiver. Presented at registration as a hard block — customers must accept to complete sign-up."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={handleSave} className="space-y-4 lg:col-span-2">
          <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <Label htmlFor="waiver-body">Waiver text</Label>
              <span className="text-[11px] text-muted">
                Rich text editor in production · plain HTML here
              </span>
            </div>
            <textarea
              id="waiver-body"
              value={draftHtml}
              onChange={(e) => setDraftHtml(e.target.value)}
              className="font-mono flex min-h-[480px] w-full rounded-lg border border-border bg-paper px-3 py-2 text-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </section>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-muted">
              Last updated {formatRelative(waiver.updatedAt)}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={!dirty}
                onClick={() => setDraftHtml(waiver.bodyHtml)}
              >
                Reset
              </Button>
              <Button type="submit" disabled={!dirty}>
                <Save className="h-4 w-4" /> Save waiver
              </Button>
            </div>
          </div>
        </form>

        <aside className="space-y-3">
          <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <div className="mb-3 flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-sage" />
              <h3 className="text-sm font-semibold text-ink">Signed</h3>
            </div>
            <div className="text-3xl font-semibold tabular-nums text-ink">{signedCount}</div>
            <p className="mt-1 text-xs text-muted">
              Individual signed dates surface on each customer profile.
            </p>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <h3 className="mb-2 text-sm font-semibold text-ink">Preview</h3>
            <div
              className="max-h-96 overflow-y-auto rounded-lg border border-border bg-paper p-3 text-xs [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold [&_p]:my-1.5"
              dangerouslySetInnerHTML={{ __html: draftHtml }}
            />
          </section>

          <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <h3 className="mb-2 text-sm font-semibold text-ink">Update behaviour</h3>
            <p className="text-xs text-muted">
              Saving replaces the current waiver body. Existing signed customers are not required
              to re-sign — their original timestamp stands.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
