"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { Button, Input, Label, PageHeader, Badge } from "@/components/ui";
import { classTypes, instructors, locations } from "@/data";
import { WorkshopDaysEditor } from "./workshop-days-editor";
import { WorkshopTiersEditor } from "./workshop-tiers-editor";
import type { Workshop, WorkshopDay, WorkshopTier } from "@/types";

type Mode = "range" | "individual";

function inferMode(days: WorkshopDay[]): Mode {
  if (days.length <= 1) return "range";
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].date + "T00:00:00");
    const cur = new Date(sorted[i].date + "T00:00:00");
    const diffDays = Math.round((cur.getTime() - prev.getTime()) / 86400_000);
    if (diffDays !== 1) return "individual";
  }
  return "range";
}

export function WorkshopEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: Workshop | null;
  onSave: (w: Workshop) => void;
  onCancel: () => void;
}) {
  const id = initial?.id ?? `ws-${Date.now().toString(36)}`;
  const [name, setName] = useState(initial?.name ?? "");
  const [classTypeId, setClassTypeId] = useState(
    initial?.classTypeId ?? classTypes.filter((c) => !c.archivedAt)[0]?.id ?? ""
  );
  const [locationId, setLocationId] = useState(
    initial?.locationId ?? locations.filter((l) => !l.archivedAt)[0]?.id ?? ""
  );
  const [instructorIds, setInstructorIds] = useState<string[]>(initial?.instructorIds ?? []);
  const [descriptionHtml, setDescriptionHtml] = useState(initial?.descriptionHtml ?? "");
  const [days, setDays] = useState<WorkshopDay[]>(initial?.days ?? []);
  const [tiers, setTiers] = useState<WorkshopTier[]>(initial?.tiers ?? []);
  const [mode, setMode] = useState<Mode>(initial ? inferMode(initial.days) : "range");
  const [rangeStart, setRangeStart] = useState(initial?.days[0]?.date ?? "");
  const [rangeEnd, setRangeEnd] = useState(
    initial?.days[initial.days.length - 1]?.date ?? ""
  );
  const [error, setError] = useState<string | null>(null);

  function toggleInstructor(iid: string) {
    setInstructorIds((prev) =>
      prev.includes(iid) ? prev.filter((x) => x !== iid) : [...prev, iid]
    );
  }

  function handleSave() {
    if (!name.trim()) return setError("Name is required.");
    if (days.length === 0) return setError("Add at least one day.");
    if (tiers.length === 0) return setError("Add at least one pricing tier.");
    for (const t of tiers) {
      if (!t.name.trim()) return setError("Every tier needs a name.");
      if (t.dayIds.length === 0) return setError(`Tier "${t.name}" needs at least one day.`);
      if (t.earlyBirdPriceSgd !== null && t.earlyBirdPriceSgd >= t.priceSgd) {
        return setError(`Tier "${t.name}": early-bird price must be lower than tier price.`);
      }
    }
    setError(null);
    const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
    onSave({
      id,
      name: name.trim(),
      classTypeId,
      locationId,
      instructorIds,
      coverUrl: initial?.coverUrl ?? null,
      additionalImages: initial?.additionalImages ?? [],
      descriptionHtml,
      days: sortedDays,
      tiers,
      lifecycle: initial?.lifecycle ?? "active",
      cancelledAt: initial?.cancelledAt ?? null,
      cancelledByStaffId: initial?.cancelledByStaffId ?? null,
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-12">
      <div>
        <Link
          href="/admin/packages/workshops"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Workshops
        </Link>
        <PageHeader
          title={initial ? "Edit workshop" : "New workshop"}
          description="Configure basics first, then days, then pricing tiers."
        />
      </div>

      <Section title="Basics">
        <div className="space-y-1.5">
          <Label htmlFor="ws-name">Name</Label>
          <Input
            id="ws-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekend Aerial Intensive"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ws-classtype">Class type</Label>
            <select
              id="ws-classtype"
              value={classTypeId}
              onChange={(e) => setClassTypeId(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              {classTypes
                .filter((c) => !c.archivedAt)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-location">Location</Label>
            <select
              id="ws-location"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              {locations
                .filter((l) => !l.archivedAt)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Instructors</Label>
          <div className="flex flex-wrap gap-2">
            {instructors
              .filter((i) => !i.archivedAt)
              .map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => toggleInstructor(i.id)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    instructorIds.includes(i.id)
                      ? "border-accent bg-accent/10 text-ink"
                      : "border-border bg-card text-muted"
                  }`}
                >
                  {i.name}
                </button>
              ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-desc">Description (HTML)</Label>
          <textarea
            id="ws-desc"
            rows={4}
            value={descriptionHtml}
            onChange={(e) => setDescriptionHtml(e.target.value)}
            placeholder="<p>What clients will experience…</p>"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
      </Section>

      <Section title="Days">
        <WorkshopDaysEditor
          mode={mode}
          onModeChange={setMode}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onRangeChange={(s, e) => {
            setRangeStart(s);
            setRangeEnd(e);
          }}
          days={days}
          onChange={setDays}
        />
      </Section>

      <Section title="Pricing tiers">
        <WorkshopTiersEditor
          workshopId={id}
          days={days}
          tiers={tiers}
          onChange={setTiers}
        />
      </Section>

      {error && (
        <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave}>
          <Save className="h-4 w-4" /> Save workshop
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <Badge tone="neutral">
          {title === "Basics" ? "1" : title === "Days" ? "2" : "3"}
        </Badge>
      </div>
      {children}
    </section>
  );
}
