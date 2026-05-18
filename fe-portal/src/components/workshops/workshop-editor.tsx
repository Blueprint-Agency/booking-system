"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Save, Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Label, PageHeader, Badge } from "@/components/ui";
import { WorkshopDaysEditor } from "./workshop-days-editor";
import { WorkshopTiersEditor } from "./workshop-tiers-editor";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError, type Api } from "@/lib/api";
import type { Workshop, WorkshopDay, WorkshopTier } from "@/types";

type Mode = "range" | "individual";

interface ApiCatalog {
  classTypes: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  instructors: Array<{ id: string; name: string; archived_at: string | null }>;
}

interface ApiWorkshopDetail {
  id: string;
  name: string;
  class_type_id: string;
  location_id: string;
  description_html: string | null;
  cover_r2_key: string | null;
  lifecycle: "active" | "cancelled";
  days: Array<{
    id: string;
    ord: number;
    starts_at: string;
    ends_at: string;
    capacity_online: number;
    capacity_waitlist: number;
    capacity_buffer: number;
  }>;
  tiers: Array<{
    id: string;
    name: string;
    description: string | null;
    regular_price_sgd: string;
    early_bird_price_sgd: string | null;
    early_bird_quota: number | null;
    early_bird_cutoff_at: string | null;
    ord: number;
    day_ids: string[];
  }>;
  instructor_ids: string[];
}

function inferMode(days: WorkshopDay[]): Mode {
  if (days.length <= 1) return "range";
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].date + "T00:00:00");
    const cur = new Date(sorted[i].date + "T00:00:00");
    const diffDays = Math.round((cur.getTime() - prev.getTime()) / 86_400_000);
    if (diffDays !== 1) return "individual";
  }
  return "range";
}

function dayToApi(d: WorkshopDay, ord: number) {
  return {
    ord,
    starts_at: new Date(`${d.date}T${d.startTime}:00`).toISOString(),
    ends_at: new Date(`${d.date}T${d.endTime}:00`).toISOString(),
    capacity_online: d.capacity.onlineBooking,
    capacity_waitlist: d.capacity.waitlist,
    capacity_buffer: d.capacity.buffer,
  };
}

function tierToApi(t: WorkshopTier, ord: number, idMap: Map<string, string>) {
  return {
    name: t.name,
    description: t.description || null,
    regular_price_sgd: String(t.priceSgd),
    early_bird_price_sgd:
      t.earlyBirdPriceSgd != null ? String(t.earlyBirdPriceSgd) : null,
    early_bird_quota: null,
    early_bird_cutoff_at: t.earlyBirdCutoffAt,
    ord,
    day_ids: t.dayIds
      .map((local) => idMap.get(local) ?? null)
      .filter((x): x is string => x !== null),
  };
}

function fromApiWorkshop(d: ApiWorkshopDetail): Workshop {
  return {
    id: d.id,
    name: d.name,
    classTypeId: d.class_type_id,
    locationId: d.location_id,
    instructorIds: d.instructor_ids,
    coverUrl: null,
    additionalImages: [],
    descriptionHtml: d.description_html ?? "",
    days: d.days
      .slice()
      .sort((a, b) => a.ord - b.ord)
      .map((day) => {
        const start = new Date(day.starts_at);
        const end = new Date(day.ends_at);
        return {
          id: day.id,
          date: start.toISOString().slice(0, 10),
          startTime: start.toISOString().slice(11, 16),
          endTime: end.toISOString().slice(11, 16),
          capacity: {
            waitlist: day.capacity_waitlist,
            onlineBooking: day.capacity_online,
            buffer: day.capacity_buffer,
          },
        } satisfies WorkshopDay;
      }),
    tiers: d.tiers
      .slice()
      .sort((a, b) => a.ord - b.ord)
      .map((tier) => ({
        id: tier.id,
        workshopId: d.id,
        name: tier.name,
        description: tier.description ?? "",
        dayIds: tier.day_ids,
        priceSgd: Number(tier.regular_price_sgd),
        earlyBirdPriceSgd:
          tier.early_bird_price_sgd != null ? Number(tier.early_bird_price_sgd) : null,
        earlyBirdCutoffAt: tier.early_bird_cutoff_at,
      })),
    lifecycle: d.lifecycle,
    cancelledAt: null,
    cancelledByStaffId: null,
  };
}

async function createWorkshopWithChildren(
  api: Api,
  args: {
    name: string;
    classTypeId: string;
    locationId: string;
    descriptionHtml: string;
    instructorIds: string[];
    days: WorkshopDay[];
    tiers: WorkshopTier[];
  },
) {
  // 1. POST basics
  const basics = await api.post<{ id: string }>("/portal/admin/workshops", {
    name: args.name,
    class_type_id: args.classTypeId,
    location_id: args.locationId,
    description_html: args.descriptionHtml || null,
    instructor_ids: args.instructorIds,
    image_r2_keys: [],
  });

  // 2. POST each day — track local -> server id mapping so tiers can reference them
  const dayIdMap = new Map<string, string>();
  let ord = 1;
  for (const day of args.days) {
    const created = await api.post<{ id: string }>(
      `/portal/admin/workshops/${basics.id}/days`,
      dayToApi(day, ord++),
    );
    dayIdMap.set(day.id, created.id);
  }

  // 3. POST each tier referencing server-side day ids
  let tierOrd = 1;
  for (const tier of args.tiers) {
    await api.post(
      `/portal/admin/workshops/${basics.id}/tiers`,
      tierToApi(tier, tierOrd++, dayIdMap),
    );
  }
  return basics.id;
}

export function WorkshopEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: Workshop | null;
  onSave: (id: string) => void;
  onCancel: () => void;
}) {
  const { api } = useWorkspace();
  const [catalog, setCatalog] = useState<ApiCatalog>({
    classTypes: [],
    locations: [],
    instructors: [],
  });

  const [name, setName] = useState(initial?.name ?? "");
  const [classTypeId, setClassTypeId] = useState(initial?.classTypeId ?? "");
  const [locationId, setLocationId] = useState(initial?.locationId ?? "");
  const [instructorIds, setInstructorIds] = useState<string[]>(initial?.instructorIds ?? []);
  const [descriptionHtml, setDescriptionHtml] = useState(initial?.descriptionHtml ?? "");
  const [days, setDays] = useState<WorkshopDay[]>(initial?.days ?? []);
  const [tiers, setTiers] = useState<WorkshopTier[]>(initial?.tiers ?? []);
  const [mode, setMode] = useState<Mode>(initial ? inferMode(initial.days) : "range");
  const [rangeStart, setRangeStart] = useState(initial?.days[0]?.date ?? "");
  const [rangeEnd, setRangeEnd] = useState(
    initial?.days[initial.days.length - 1]?.date ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = !!initial;

  const loadCatalog = useCallback(async () => {
    if (!api) return;
    try {
      const [ct, loc, ins] = await Promise.all([
        api.get<{ class_types: Array<{ id: string; name: string }> }>(
          "/portal/admin/class-types",
        ),
        api.get<{
          locations: Array<{ id: string; name: string; archived_at: string | null }>;
        }>("/portal/admin/locations"),
        api.get<{
          instructors: Array<{ id: string; name: string; archived_at: string | null }>;
        }>("/portal/admin/instructors"),
      ]);
      setCatalog({
        classTypes: ct.class_types,
        locations: loc.locations.filter((l) => !l.archived_at),
        instructors: ins.instructors,
      });
      if (!classTypeId && ct.class_types[0]) setClassTypeId(ct.class_types[0].id);
      if (!locationId && loc.locations[0]) setLocationId(loc.locations[0].id);
    } catch {
      // surfaced via the form's general error display when save fails
    }
  }, [api, classTypeId, locationId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  function toggleInstructor(iid: string) {
    setInstructorIds((prev) =>
      prev.includes(iid) ? prev.filter((x) => x !== iid) : [...prev, iid],
    );
  }

  async function handleSave() {
    if (!api) return;
    if (!name.trim()) return setError("Name is required.");
    if (!classTypeId) return setError("Class type is required.");
    if (!locationId) return setError("Location is required.");
    if (!isEdit && days.length === 0) return setError("Add at least one day.");
    if (!isEdit && tiers.length === 0) return setError("Add at least one pricing tier.");
    for (const t of tiers) {
      if (!t.name.trim()) return setError("Every tier needs a name.");
      if (t.dayIds.length === 0) return setError(`Tier "${t.name}" needs at least one day.`);
      if (t.earlyBirdPriceSgd !== null && t.earlyBirdPriceSgd >= t.priceSgd) {
        return setError(`Tier "${t.name}": early-bird price must be lower than tier price.`);
      }
    }
    setError(null);
    setSaving(true);
    try {
      if (isEdit && initial) {
        // v0 edit: patch basics only. Day/tier edits require per-row PATCH/DELETE
        // flows that are scope for v1.
        await api.patch(`/portal/admin/workshops/${initial.id}`, {
          name: name.trim(),
          class_type_id: classTypeId,
          location_id: locationId,
          description_html: descriptionHtml || null,
          instructor_ids: instructorIds,
        });
        toast.success("Workshop basics updated. (Editing days/tiers ships in v1.)");
        onSave(initial.id);
      } else {
        const id = await createWorkshopWithChildren(api, {
          name: name.trim(),
          classTypeId,
          locationId,
          descriptionHtml,
          instructorIds,
          days: [...days].sort((a, b) => a.date.localeCompare(b.date)),
          tiers,
        });
        toast.success("Workshop created.");
        onSave(id);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? `Save failed (HTTP ${err.status}).` : "Save failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelWorkshop() {
    if (!api || !initial) return;
    if (!confirm("Cancel this workshop? This is irreversible.")) return;
    try {
      await api.post(`/portal/admin/workshops/${initial.id}/cancel`);
      toast.success("Workshop cancelled.");
      onSave(initial.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? `Cancel failed (HTTP ${err.status}).` : "Cancel failed.");
    }
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
          description={
            initial
              ? "Edit basics. Day & tier edits ship in v1."
              : "Configure basics first, then days, then pricing tiers."
          }
          actions={
            initial && initial.lifecycle === "active" ? (
              <Button variant="secondary" size="sm" onClick={handleCancelWorkshop}>
                <Ban className="h-3.5 w-3.5" /> Cancel workshop
              </Button>
            ) : undefined
          }
        />
      </div>

      <Section title="Basics" step="1">
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
              <option value="">— select —</option>
              {catalog.classTypes.map((c) => (
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
              <option value="">— select —</option>
              {catalog.locations.map((l) => (
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
            {catalog.instructors
              .filter((i) => !i.archived_at)
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

      <Section
        title="Days"
        step="2"
        note={isEdit ? "Day-level edits ship in v1; currently read-only." : undefined}
      >
        {isEdit ? (
          <ul className="space-y-1 text-sm text-ink">
            {days.map((d) => (
              <li key={d.id} className="rounded-md border border-border bg-paper px-3 py-2">
                {d.date} · {d.startTime}–{d.endTime} · cap {d.capacity.onlineBooking}
              </li>
            ))}
            {days.length === 0 && (
              <p className="text-xs text-muted">No days configured.</p>
            )}
          </ul>
        ) : (
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
        )}
      </Section>

      <Section
        title="Pricing tiers"
        step="3"
        note={isEdit ? "Tier edits ship in v1; currently read-only." : undefined}
      >
        {isEdit ? (
          <ul className="space-y-1 text-sm text-ink">
            {tiers.map((t) => (
              <li key={t.id} className="rounded-md border border-border bg-paper px-3 py-2">
                {t.name} · S${t.priceSgd} · {t.dayIds.length} day
                {t.dayIds.length === 1 ? "" : "s"}
              </li>
            ))}
            {tiers.length === 0 && (
              <p className="text-xs text-muted">No tiers configured.</p>
            )}
          </ul>
        ) : (
          <WorkshopTiersEditor
            workshopId="new"
            days={days}
            tiers={tiers}
            onChange={setTiers}
          />
        )}
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
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Save className="h-4 w-4" /> Save workshop
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  step,
  note,
  children,
}: {
  title: string;
  step: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <Badge tone="neutral">{step}</Badge>
        {note && <span className="text-[11px] text-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

// Re-export for legacy callers that imported from this module.
export { fromApiWorkshop };
