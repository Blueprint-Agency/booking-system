"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Save, Ban, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button, Input, Label, PageHeader, Badge } from "@/components/ui";
import { WorkshopDaysEditor, newDay } from "./workshop-days-editor";
import { WorkshopTiersEditor } from "./workshop-tiers-editor";
import { PromotionsEditor } from "@/components/packages/promotions-editor";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError, type Api } from "@/lib/api";
import {
  fetchActiveInstructors,
  fetchActiveLocations,
  fetchActiveRooms,
  type CatalogInstructor,
  type CatalogLocation,
  type CatalogRoom,
} from "@/lib/catalog";
import { atLocalTime, localDay } from "@/lib/local-day";
import { scheduleErrorMessage, type Slot } from "@/lib/schedule";
import {
  hasPromotionOverlap,
  promotionFromApi,
  promotionToApiPayload,
  type ApiPromotion,
} from "@/lib/promotions";
import type { Workshop, WorkshopDay, WorkshopTier, Promotion } from "@/types";

type Mode = "range" | "individual";

interface Catalog {
  locations: CatalogLocation[];
  instructors: CatalogInstructor[];
  rooms: CatalogRoom[];
}

interface ApiWorkshopDetail {
  id: string;
  name: string;
  location_id: string;
  description_html: string | null;
  cover_r2_key: string | null;
  lifecycle: "active" | "cancelled";
  days: Array<{
    id: string;
    ord: number;
    room_id: string | null;
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
  main_instructor_id: string | null;
  main_instructor_pay_sgd?: number | null;
  supporting_instructor_ids: string[];
  supporting_instructors?: Array<{ instructor_id: string; pay_sgd: number | null }>;
  /** Back-compat: `[main, ...supporting]`. */
  instructor_ids: string[];
  promotions?: ApiPromotion[];
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
    room_id: d.roomId,
    starts_at: atLocalTime(d.date, d.startTime).toISOString(),
    ends_at: atLocalTime(d.date, d.endTime).toISOString(),
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
  const mainInstructorId = d.main_instructor_id ?? d.instructor_ids[0] ?? "";
  const supportingInstructorIds =
    d.supporting_instructor_ids ??
    d.instructor_ids.filter((id) => id !== mainInstructorId);
  const supportingInstructorPay: Record<string, number | null> = {};
  for (const s of d.supporting_instructors ?? []) {
    supportingInstructorPay[s.instructor_id] = s.pay_sgd;
  }
  return {
    id: d.id,
    name: d.name,
    locationId: d.location_id,
    mainInstructorId,
    supportingInstructorIds,
    instructorIds: mainInstructorId
      ? [mainInstructorId, ...supportingInstructorIds]
      : supportingInstructorIds,
    mainInstructorPaySgd: d.main_instructor_pay_sgd ?? null,
    supportingInstructorPay,
    descriptionHtml: d.description_html ?? "",
    days: d.days
      .slice()
      .sort((a, b) => a.ord - b.ord)
      .map((day) => {
        const start = new Date(day.starts_at);
        const end = new Date(day.ends_at);
        // dayToApi writes wall-clock time as a local-zone Date, so read it back
        // in the browser's local zone too.
        return {
          id: day.id,
          date: localDay(start),
          startTime: format(start, "HH:mm"),
          endTime: format(end, "HH:mm"),
          roomId: day.room_id ?? "",
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
    promotions: (d.promotions ?? []).map(promotionFromApi),
    lifecycle: d.lifecycle,
    cancelledAt: null,
    cancelledByStaffId: null,
  };
}

async function createWorkshopWithChildren(
  api: Api,
  args: {
    name: string;
    locationId: string;
    descriptionHtml: string;
    mainInstructorId: string;
    supportingInstructorIds: string[];
    days: WorkshopDay[];
    tiers: WorkshopTier[];
  },
) {
  // 1. POST basics
  const basics = await api.post<{ id: string }>("/portal/admin/workshops", {
    name: args.name,
    location_id: args.locationId,
    description_html: args.descriptionHtml || null,
    main_instructor_id: args.mainInstructorId,
    supporting_instructor_ids: args.supportingInstructorIds,
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

/**
 * Reconcile an existing workshop's days/tiers against their originally-loaded
 * state: rows still carrying their original (server) id are PATCHed in place,
 * rows without a matching original id are new and get POSTed, and original
 * rows no longer present get DELETEd. Deletes run first so freed room/time
 * slots and day ids are available to the update/create passes that follow.
 * Order: delete tiers -> delete days -> update/create days -> update/create
 * tiers (tier day_ids are remapped/filtered through the day id map so stale
 * references to a removed day are dropped, same as the create flow).
 */
async function saveDaysAndTiers(
  api: Api,
  workshopId: string,
  originalDays: WorkshopDay[],
  currentDaysUnsorted: WorkshopDay[],
  originalTiers: WorkshopTier[],
  currentTiers: WorkshopTier[],
) {
  const originalDayIds = new Set(originalDays.map((d) => d.id));
  const currentDays = [...currentDaysUnsorted].sort((a, b) => a.date.localeCompare(b.date));
  const currentDayIds = new Set(currentDays.map((d) => d.id));
  const originalTierIds = new Set(originalTiers.map((t) => t.id));
  const currentTierIds = new Set(currentTiers.map((t) => t.id));

  for (const t of originalTiers) {
    if (!currentTierIds.has(t.id)) {
      await api.del(`/portal/admin/workshops/${workshopId}/tiers/${t.id}`);
    }
  }
  for (const d of originalDays) {
    if (!currentDayIds.has(d.id)) {
      await api.del(`/portal/admin/workshops/${workshopId}/days/${d.id}`);
    }
  }

  const dayIdMap = new Map<string, string>();
  let dayOrd = 1;
  for (const d of currentDays) {
    if (originalDayIds.has(d.id)) {
      await api.patch(`/portal/admin/workshops/${workshopId}/days/${d.id}`, dayToApi(d, dayOrd++));
      dayIdMap.set(d.id, d.id);
    } else {
      const created = await api.post<{ id: string }>(
        `/portal/admin/workshops/${workshopId}/days`,
        dayToApi(d, dayOrd++),
      );
      dayIdMap.set(d.id, created.id);
    }
  }

  let tierOrd = 1;
  for (const t of currentTiers) {
    const payload = tierToApi(t, tierOrd++, dayIdMap);
    if (originalTierIds.has(t.id)) {
      await api.patch(`/portal/admin/workshops/${workshopId}/tiers/${t.id}`, payload);
    } else {
      await api.post(`/portal/admin/workshops/${workshopId}/tiers`, payload);
    }
  }
}

function parsePay(v: string): number | null {
  const t = v.trim();
  return t === "" ? null : Number(t);
}

export function WorkshopEditor({
  initial,
  slot,
  onSave,
  onCancel,
}: {
  initial: Workshop | null;
  /** Slot picked off the timetable grid — seeds the workshop's first day. */
  slot?: Slot;
  onSave: (id: string) => void;
  onCancel: () => void;
}) {
  const { api } = useWorkspace();
  const [catalog, setCatalog] = useState<Catalog>({
    locations: [],
    instructors: [],
    rooms: [],
  });

  const [name, setName] = useState(initial?.name ?? "");
  const [locationId, setLocationId] = useState(initial?.locationId ?? "");
  const [mainInstructorId, setMainInstructorId] = useState<string>(
    initial?.mainInstructorId ?? "",
  );
  const [supportingInstructorIds, setSupportingInstructorIds] = useState<string[]>(
    initial?.supportingInstructorIds ?? [],
  );
  const [mainPay, setMainPay] = useState(
    initial?.mainInstructorPaySgd == null ? "" : String(initial.mainInstructorPaySgd),
  );
  const [supportingPay, setSupportingPay] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const id of initial?.supportingInstructorIds ?? []) {
      const v = initial?.supportingInstructorPay?.[id];
      map[id] = v == null ? "" : String(v);
    }
    return map;
  });
  const [descriptionHtml, setDescriptionHtml] = useState(initial?.descriptionHtml ?? "");
  const [days, setDays] = useState<WorkshopDay[]>(
    initial?.days ??
      (slot
        ? [{ ...newDay(slot.date), startTime: slot.start, endTime: slot.end }]
        : []),
  );
  const [tiers, setTiers] = useState<WorkshopTier[]>(initial?.tiers ?? []);
  const [promotions, setPromotions] = useState<Promotion[]>(initial?.promotions ?? []);
  const [mode, setMode] = useState<Mode>(initial ? inferMode(initial.days) : "range");
  const [rangeStart, setRangeStart] = useState(
    initial?.days[0]?.date ?? slot?.date ?? "",
  );
  const [rangeEnd, setRangeEnd] = useState(
    initial?.days[initial.days.length - 1]?.date ?? slot?.date ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = !!initial;

  const loadCatalog = useCallback(async () => {
    if (!api) return;
    try {
      const [loc, ins, rm] = await Promise.all([
        fetchActiveLocations(api),
        fetchActiveInstructors(api),
        fetchActiveRooms(api),
      ]);
      setCatalog({ locations: loc, instructors: ins, rooms: rm });
      if (!locationId && loc[0]) setLocationId(loc[0].id);
    } catch {
      // surfaced via the form's general error display when save fails
    }
  }, [api, locationId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const availableForSupporting = useMemo(
    () =>
      catalog.instructors.filter(
        (i) => i.id !== mainInstructorId && !supportingInstructorIds.includes(i.id),
      ),
    [catalog.instructors, mainInstructorId, supportingInstructorIds],
  );

  // If the chosen main overlaps a supporting one, drop the dup.
  useEffect(() => {
    if (!mainInstructorId) return;
    setSupportingInstructorIds((prev) => prev.filter((id) => id !== mainInstructorId));
  }, [mainInstructorId]);

  function removeSupporting(iid: string) {
    setSupportingInstructorIds((prev) => prev.filter((x) => x !== iid));
  }

  async function handleSave() {
    if (!api) return;
    if (!name.trim()) return setError("Name is required.");
    if (!locationId) return setError("Location is required.");
    if (!mainInstructorId) return setError("Main instructor is required.");
    if (days.length === 0) return setError("Add at least one day.");
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const label = `Day ${i + 1}`;
      if (!d.roomId) return setError(`${label}: pick a room.`);
      if (!d.date) return setError(`${label}: date is required.`);
      if (!d.startTime || !d.endTime)
        return setError(`${label}: start and end time are required.`);
      if (d.endTime <= d.startTime)
        return setError(`${label}: end time must be after start time.`);
      if (d.capacity.onlineBooking < 1)
        return setError(`${label}: online booking capacity must be at least 1.`);
    }
    if (tiers.length === 0) return setError("Add at least one pricing tier.");
    // Drop references to days that have since been removed from the form —
    // otherwise a tier can look non-empty locally but map to zero valid days.
    const currentDayIdSet = new Set(days.map((d) => d.id));
    const prunedTiers = tiers.map((t) => ({
      ...t,
      dayIds: t.dayIds.filter((id) => currentDayIdSet.has(id)),
    }));
    for (const t of prunedTiers) {
      if (!t.name.trim()) return setError("Every tier needs a name.");
      if (t.dayIds.length === 0) return setError(`Tier "${t.name}" needs at least one day.`);
      if (t.priceSgd < 0) return setError(`Tier "${t.name}": price cannot be negative.`);
      if (t.earlyBirdPriceSgd !== null) {
        if (t.earlyBirdPriceSgd >= t.priceSgd) {
          return setError(`Tier "${t.name}": early-bird price must be lower than tier price.`);
        }
        if (!t.earlyBirdCutoffAt) {
          return setError(`Tier "${t.name}": set an early-bird cutoff so the discount expires.`);
        }
      }
    }
    if (hasPromotionOverlap(promotions)) {
      return setError("Promotions overlap in time — each day can have at most one active promotion.");
    }
    setError(null);
    setSaving(true);
    try {
      if (isEdit && initial) {
        await api.patch(`/portal/admin/workshops/${initial.id}`, {
          name: name.trim(),
          location_id: locationId,
          description_html: descriptionHtml || null,
          main_instructor_id: mainInstructorId,
          main_instructor_pay_sgd: parsePay(mainPay),
          supporting_instructors: supportingInstructorIds.map((iid) => ({
            instructor_id: iid,
            pay_sgd: parsePay(supportingPay[iid] ?? ""),
          })),
        });
        await saveDaysAndTiers(
          api,
          initial.id,
          initial.days,
          days,
          initial.tiers,
          prunedTiers,
        );
        await api.put(`/portal/admin/workshops/${initial.id}/promotions`, {
          promotions: promotions.map(promotionToApiPayload),
        });
        toast.success("Workshop saved.");
        onSave(initial.id);
      } else {
        const id = await createWorkshopWithChildren(api, {
          name: name.trim(),
          locationId,
          descriptionHtml,
          mainInstructorId,
          supportingInstructorIds,
          days: [...days].sort((a, b) => a.date.localeCompare(b.date)),
          tiers: prunedTiers,
        });
        const hasPay =
          mainPay.trim() !== "" ||
          supportingInstructorIds.some((iid) => (supportingPay[iid] ?? "").trim() !== "");
        if (hasPay) {
          await api.patch(`/portal/admin/workshops/${id}`, {
            main_instructor_pay_sgd: parsePay(mainPay),
            supporting_instructors: supportingInstructorIds.map((iid) => ({
              instructor_id: iid,
              pay_sgd: parsePay(supportingPay[iid] ?? ""),
            })),
          });
        }
        if (promotions.length) {
          await api.put(`/portal/admin/workshops/${id}/promotions`, {
            promotions: promotions.map(promotionToApiPayload),
          });
        }
        toast.success("Workshop created.");
        onSave(id);
      }
    } catch (err) {
      const msg = scheduleErrorMessage(err);
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
              ? "Edit basics, days, and pricing tiers."
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
        <div className="space-y-1.5">
          <Label htmlFor="ws-location">Location</Label>
          <select
            id="ws-location"
            value={locationId}
            onChange={(e) => {
              const next = e.target.value;
              setLocationId(next);
              if (next !== locationId) {
                // Rooms are scoped per location — clear stale picks so the BE
                // can't reject the save with room_location_mismatch.
                setDays((cur) => cur.map((d) => ({ ...d, roomId: "" })));
              }
            }}
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
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ws-main-instructor">Main instructor</Label>
            <select
              id="ws-main-instructor"
              value={mainInstructorId}
              onChange={(e) => setMainInstructorId(e.target.value)}
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="">— select —</option>
              {catalog.instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-main-pay">Main instructor pay (SGD)</Label>
            <Input
              id="ws-main-pay"
              type="number"
              min={0}
              placeholder="Optional"
              value={mainPay}
              onChange={(e) => setMainPay(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Supporting instructors</Label>
          <div className="space-y-2">
            {supportingInstructorIds.map((sid) => {
              const ins = catalog.instructors.find((i) => i.id === sid);
              return (
                <div
                  key={sid}
                  className="flex items-center gap-2 rounded-md border border-border bg-paper px-3 py-2"
                >
                  <span className="flex-1 text-sm text-ink">{ins?.name ?? "Unknown"}</span>
                  <Input
                    type="number"
                    min={0}
                    placeholder="Pay (SGD)"
                    value={supportingPay[sid] ?? ""}
                    onChange={(e) =>
                      setSupportingPay((prev) => ({ ...prev, [sid]: e.target.value }))
                    }
                    className="w-32"
                  />
                  <button
                    type="button"
                    onClick={() => removeSupporting(sid)}
                    className="text-muted hover:text-ink"
                    aria-label={`Remove ${ins?.name ?? "instructor"}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {availableForSupporting.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) setSupportingInstructorIds((prev) => [...prev, v]);
                }}
                className="flex h-9 rounded-lg border border-border bg-card px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">
                  {supportingInstructorIds.length === 0
                    ? "+ Add supporting instructor"
                    : "+ Add another"}
                </option>
                {availableForSupporting.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
            {supportingInstructorIds.length === 0 && availableForSupporting.length === 0 && (
              <span className="text-xs text-muted">
                No additional instructors available.
              </span>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-desc">Description (HTML)</Label>
          <textarea
            id="ws-desc"
            rows={4}
            value={descriptionHtml}
            onChange={(e) => setDescriptionHtml(e.target.value)}
            placeholder="<p>What customers will experience…</p>"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
      </Section>

      <Section title="Days" step="2">
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
          rooms={catalog.rooms
            .filter((r) => r.location_id === locationId)
            .map((r) => ({ id: r.id, name: r.name }))}
          locationChosen={!!locationId}
        />
      </Section>

      <Section title="Pricing tiers" step="3">
        <WorkshopTiersEditor
          workshopId={initial?.id ?? "new"}
          days={days}
          tiers={tiers}
          onChange={setTiers}
        />
      </Section>

      <Section title="Promotions" step="4">
        <p className="text-xs text-muted">
          Promotions apply uniformly across every pricing tier. The highest tier price
          previews the effective price.
        </p>
        <PromotionsEditor
          basePriceSgd={Math.max(0, ...tiers.map((t) => t.priceSgd))}
          value={promotions}
          onChange={setPromotions}
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
