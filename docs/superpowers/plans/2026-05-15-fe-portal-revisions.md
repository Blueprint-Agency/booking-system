# fe-portal revisions implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the eight fe-portal revisions described in `docs/superpowers/specs/2026-05-15-fe-portal-class-types-locations-packages-design.md` against the existing Next.js admin mockup (no backend, no tests). fe-client changes are deferred to a separate plan.

**Architecture:** Mockup-layer work in `fe-portal/`. Types and seed data first (single source of truth), then shared form components, then surfaces (pages) one section at a time. Each task ends with a smoke check: start `pnpm dev` (if not running), visit the affected route, verify the listed behaviour, then commit.

**Tech Stack:** Next.js App Router · TypeScript · Tailwind · shadcn/ui · client-side `useState` seed data (no backend wiring).

**Test strategy:** fe-portal has no Vitest/Jest setup and is a clickable mockup. Each task uses a **manual smoke check** rather than automated tests — visit the route, perform the action, confirm the listed outcome. `pnpm typecheck` (if available) is the only automated gate run per task. Tasks must compile cleanly.

---

## Task 0 — Pre-flight

**Files:**
- Read: `fe-portal/package.json` (confirm scripts)
- Read: `fe-portal/src/types/index.ts`

- [ ] **Step 1**: Confirm `pnpm dev` starts the portal on port 3001 from `fe-portal/`. Confirm `pnpm typecheck` (or `pnpm tsc --noEmit`) is available; if not, use `pnpm exec tsc --noEmit` directly.
- [ ] **Step 2**: Note: every task ends with `pnpm exec tsc --noEmit` from `fe-portal/` passing cleanly and a manual smoke check on the affected route.

---

## Task 1 — Types & shared helpers

Lay down every new/changed interface in one pass so later tasks compile against the right shape. **Do not edit seeds yet** — Task 2 handles seed migration.

**Files:**
- Modify: `fe-portal/src/types/index.ts`
- Create: `fe-portal/src/lib/capacity.ts`
- Create: `fe-portal/src/lib/promotions.ts`

### Step 1: Replace `ClassType` and add `ClassTypeDifficulty`

In `fe-portal/src/types/index.ts`, replace the `ClassType` interface with:

```ts
export type ClassTypeDifficulty =
  | "general"
  | "beginner"
  | "intermediate"
  | "advanced";

export interface ClassType {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  difficulty: ClassTypeDifficulty;
  archivedAt: string | null;
}
```

### Step 2: Add `Capacity` + extend events

Add `Capacity` interface (placed near `ClassInstance`):

```ts
export interface Capacity {
  waitlist: number;
  onlineBooking: number;
  buffer: number;
}
```

Update `ClassInstance.capacity`, `PtSession.capacity` to `Capacity` (replacing the existing `capacity: number`). For `WorkshopDay` see Step 5.

### Step 3: Extend `ClassPackage` + `ClassPackageKind` + add `Promotion`

```ts
export type PromotionMode = "percent" | "price";

export interface Promotion {
  id: string;
  label: string;
  mode: PromotionMode;
  percent: number | null;
  priceSgd: number | null;
  startsAt: string;
  endsAt: string;
}

export type ClassPackageKind = "credit_bundle" | "unlimited" | "trial";

export interface ClassPackage {
  id: string;
  name: string;
  description: string;
  kind: ClassPackageKind;
  credits: number | null;       // credit_bundle + trial
  validityDays: number | null;  // credit_bundle + trial (optional for trial; null = no expiry)
  durationDays: number | null;  // unlimited only
  priceSgd: number;
  status: "active" | "archived";
  promotions: Promotion[];
}

export interface PtPackage {
  id: string;
  name: string;
  sessionType: PtSessionType;
  numSessions: number;
  priceSgd: number;
  status: "active" | "archived";
  promotions: Promotion[];
}

// Update ClientPackage.kind:
export interface ClientPackage {
  id: string;
  clientId: string;
  kind: "credit_bundle" | "unlimited" | "trial" | "pt";
  sourcePackageId: string;
  packageName: string;
  creditsOrSessionsRemaining: number | null;
  creditsOrSessionsTotal: number | null;
  expiresAt: string | null;
  purchasedAt: string;
  amountPaidSgd: number;
}
```

### Step 4: Reshape `Workshop` to multi-day

Replace the existing `Workshop` block and `WorkshopTier` with:

```ts
export interface WorkshopDay {
  id: string;
  date: string;        // YYYY-MM-DD
  startTime: string;   // HH:mm
  endTime: string;     // HH:mm
  capacity: Capacity;
  basePriceSgd: number;
}

export interface WorkshopTier {
  id: string;
  workshopId: string;
  name: string;
  description: string;
  dayIds: string[];
  priceSgd: number;
  earlyBirdPriceSgd: number | null;
  earlyBirdCutoffAt: string | null;
}

export interface Workshop {
  id: string;
  name: string;
  classTypeId: string;
  locationId: string;
  instructorIds: string[];
  coverUrl: string | null;
  additionalImages: string[];
  descriptionHtml: string;
  days: WorkshopDay[];
  tiers: WorkshopTier[];
  lifecycle: Lifecycle;
  cancelledAt: string | null;
  cancelledByStaffId: string | null;
}
```

Remove `startsAt`/`endsAt` from `Workshop`. Delete any obsolete `WorkshopTier`-as-separate-array exports.

### Step 5: Add `PtRequest` types; remove `pt_request` from `InboxType`

```ts
export type PtRequestStatus = "pending" | "scheduled" | "declined" | "cancelled";

export interface PtRequestSlot {
  date: string;
  startTime: string;
}

export interface PtRequest {
  id: string;
  clientId: string;
  preferredInstructorId: string | null;
  sessionType: PtSessionType;
  durationMinutes: number;
  preferredSlots: PtRequestSlot[];
  clientNote: string;
  status: PtRequestStatus;
  ptSessionId: string | null;
  declineNote: string | null;
  decidedByStaffId: string | null;
  decidedAt: string | null;
  createdAt: string;
}
```

Update `InboxType` to drop `"pt_request"`:

```ts
export type InboxType =
  | "client_cancellation"
  | "admin_cancel_class_pt"
  | "admin_cancel_workshop";
```

Sweep `fe-portal/src/types/index.ts` for any `Availability*` interfaces and delete them.

### Step 6: Create `lib/capacity.ts`

```ts
import type { Capacity } from "@/types";

export function maxCapacity(c: Capacity): number {
  return c.waitlist + c.onlineBooking + c.buffer;
}
```

### Step 7: Create `lib/promotions.ts`

```ts
import type { ClassPackage, Promotion, PtPackage } from "@/types";

type Priced = { priceSgd: number; promotions: Promotion[] };

export function getActivePromotion(pkg: Priced, now = new Date()): Promotion | null {
  const nowIso = now.toISOString();
  const active = pkg.promotions.filter((p) => p.startsAt <= nowIso && nowIso <= p.endsAt);
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];
  // best-for-client: lowest effective price wins; tie break by earliest startsAt
  return [...active].sort((a, b) => {
    const ea = effectivePrice(pkg.priceSgd, a);
    const eb = effectivePrice(pkg.priceSgd, b);
    if (ea !== eb) return ea - eb;
    return a.startsAt.localeCompare(b.startsAt);
  })[0];
}

export function effectivePrice(base: number, promo: Promotion): number {
  if (promo.mode === "percent" && promo.percent !== null) {
    return Math.round(base * (1 - promo.percent / 100));
  }
  if (promo.mode === "price" && promo.priceSgd !== null) {
    return promo.priceSgd;
  }
  return base;
}

export function getEffectivePrice(pkg: Priced, now = new Date()) {
  const promo = getActivePromotion(pkg, now);
  return {
    price: promo ? effectivePrice(pkg.priceSgd, promo) : pkg.priceSgd,
    original: pkg.priceSgd,
    promo,
  };
}
```

### Step 8: Compile & commit

- [ ] Run `pnpm exec tsc --noEmit` from `fe-portal/`. Expect: errors only from seed data and pages that still reference old shapes. **Note them** — Tasks 2–N fix them.
- [ ] Commit: `feat(fe-portal): types & helpers for capacity, promotions, multi-day workshops, PT requests`

---

## Task 2 — Seed data migration

Migrate all seed files to the new shapes so the build compiles cleanly.

**Files:**
- Modify: `fe-portal/src/data/class-types.ts`
- Modify: `fe-portal/src/data/class-packages.ts`
- Modify: `fe-portal/src/data/pt-packages.ts`
- Modify: `fe-portal/src/data/workshops.ts`
- Modify: `fe-portal/src/data/class-instances.ts` (and any other event-data files referenced)
- Modify: `fe-portal/src/data/pt-sessions.ts`
- Modify: `fe-portal/src/data/inbox.ts`
- Create: `fe-portal/src/data/pt-requests.ts`
- Modify: `fe-portal/src/data/index.ts` (re-exports)
- Delete: any `fe-portal/src/data/availability*.ts`

### Step 1: `class-types.ts` — add fields + Aerial demo hierarchy

```ts
import type { ClassType } from "@/types";

export const classTypes: ClassType[] = [
  { id: "ct-vinyasa",  name: "Vinyasa Flow",       description: "Dynamic linked-breath flow.",        parentId: null,        difficulty: "general",      archivedAt: null },
  { id: "ct-yin",      name: "Yin Yoga",           description: "Long-held passive postures.",        parentId: null,        difficulty: "general",      archivedAt: null },
  { id: "ct-aerial",   name: "Aerial Yoga",        description: "Yoga with silk hammocks.",           parentId: null,        difficulty: "general",      archivedAt: null },
  { id: "ct-aerial-fdn", name: "Aerial Foundations", description: "Intro to aerial — beginner-friendly.", parentId: "ct-aerial", difficulty: "beginner",   archivedAt: null },
  { id: "ct-aerial-flow", name: "Aerial Flow",     description: "Continuous aerial flows.",           parentId: "ct-aerial", difficulty: "intermediate", archivedAt: null },
  { id: "ct-chair",    name: "Chair Yoga",         description: "Seated practice, accessible to all.", parentId: null,       difficulty: "general",      archivedAt: null },
  { id: "ct-prenatal", name: "Prenatal Yoga",      description: "Gentle practice for expecting mothers.", parentId: null,    difficulty: "general",      archivedAt: null },
  { id: "ct-hatha",    name: "Hatha",              description: "Foundational alignment-based yoga.", parentId: null,        difficulty: "general",      archivedAt: null },
  { id: "ct-power",    name: "Power Yoga",         description: "High-intensity vinyasa.",            parentId: null,        difficulty: "advanced",     archivedAt: "2026-01-15T08:00:00.000Z" },
];
```

### Step 2: `class-packages.ts` — add description, promotions, trial entry, CNY demo promo

Open the file. For each existing entry add `description: ""` and `promotions: []`. Append a trial pass at the top of the array:

```ts
{
  id: "pkg-trial-1class",
  name: "Trial Pass",
  description: "Drop in for your first yoga class — see if we're the right fit.",
  kind: "trial",
  credits: 1,
  validityDays: 30,
  durationDays: null,
  priceSgd: 20,
  status: "active",
  promotions: [],
},
```

On the existing `Bundle of 20` (whatever its current id is), set:

```ts
promotions: [
  {
    id: "promo-cny-bundle20",
    label: "CNY Promo",
    mode: "percent",
    percent: 25,
    priceSgd: null,
    startsAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
    endsAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
  },
],
```

### Step 3: `pt-packages.ts` — backfill `promotions: []` on every entry

Open and add `promotions: []` to each `PtPackage`.

### Step 4: `workshops.ts` — migrate to multi-day shape + add multi-day demo

For each existing workshop, generate a single `WorkshopDay` from its old `startsAt`/`endsAt`:

```ts
const day = (id, date, startTime, endTime, capInt, basePrice): WorkshopDay => ({
  id, date, startTime, endTime,
  capacity: { waitlist: 0, onlineBooking: capInt, buffer: 0 },
  basePriceSgd: basePrice,
});
```

Add one new demo workshop "Weekend Aerial Intensive" with three consecutive Saturdays, each `Capacity { waitlist: 2, onlineBooking: 12, buffer: 1 }`, base price $120, and three tiers: `Day 1 Pass` ($120), `Day 2 Pass` ($120), `Day 3 Pass` ($120), `Full Event Pass` ($300, includes all 3 dayIds, earlyBird $260 cutoff 14 days before first day).

### Step 5: `class-instances.ts` — migrate scalar `capacity` to `Capacity`

Replace every `capacity: 18` with `capacity: { waitlist: 0, onlineBooking: 18, buffer: 2 }`. Apply equivalent splits for other values (admin's intent: keep onlineBooking equal to the old capacity, buffer = 2, waitlist = 0).

### Step 6: `pt-sessions.ts` — migrate capacity

For each `PtSession`, set capacity based on `sessionType`:
- `1on1` → `{ waitlist: 0, onlineBooking: 1, buffer: 0 }`
- `2on1` → `{ waitlist: 0, onlineBooking: 2, buffer: 0 }`

### Step 7: `inbox.ts` — drop `pt_request` entries

Delete every seed item with `type: "pt_request"`. Keep cancellations.

### Step 8: `pt-requests.ts` — new seed

```ts
import type { PtRequest } from "@/types";

export const ptRequests: PtRequest[] = [
  {
    id: "req-1",
    clientId: "cli-1",
    preferredInstructorId: "inst-1",
    sessionType: "1on1",
    durationMinutes: 60,
    preferredSlots: [
      { date: "2026-05-22", startTime: "09:00" },
      { date: "2026-05-23", startTime: "10:00" },
    ],
    clientNote: "Working on shoulder mobility, prefer morning slots.",
    status: "pending",
    ptSessionId: null,
    declineNote: null,
    decidedByStaffId: null,
    decidedAt: null,
    createdAt: new Date(Date.now() - 2 * 86400_000).toISOString(),
  },
  {
    id: "req-2",
    clientId: "cli-2",
    preferredInstructorId: null,
    sessionType: "2on1",
    durationMinutes: 90,
    preferredSlots: [{ date: "2026-05-25", startTime: "18:00" }],
    clientNote: "",
    status: "pending",
    ptSessionId: null,
    declineNote: null,
    decidedByStaffId: null,
    decidedAt: null,
    createdAt: new Date(Date.now() - 1 * 86400_000).toISOString(),
  },
  {
    id: "req-3",
    clientId: "cli-3",
    preferredInstructorId: "inst-2",
    sessionType: "1on1",
    durationMinutes: 60,
    preferredSlots: [{ date: "2026-05-18", startTime: "07:00" }],
    clientNote: "Recovering from a knee niggle.",
    status: "declined",
    ptSessionId: null,
    declineNote: "Instructor on leave that week — please re-submit with another date.",
    decidedByStaffId: "staff-1",
    decidedAt: new Date(Date.now() - 12 * 3600_000).toISOString(),
    createdAt: new Date(Date.now() - 5 * 86400_000).toISOString(),
  },
];
```

### Step 9: `data/index.ts` — wire exports

Add `export { ptRequests } from "./pt-requests";`. Remove any `availability*` exports.

### Step 10: Delete `availability*.ts` seed files if they exist.

### Step 11: Typecheck + smoke check + commit

- [ ] Run `pnpm exec tsc --noEmit` from `fe-portal/`. Expect: type errors only in pages/components (Tasks 3+).
- [ ] Commit: `feat(fe-portal): migrate seed data to new shapes (capacity, promotions, workshops, PT requests)`

---

## Task 3 — Location filter chips, check-in pill, fresh-install gate

**Files:**
- Create: `fe-portal/src/components/locations/location-filter-chips.tsx`
- Create: `fe-portal/src/components/locations/checkin-location-pill.tsx`
- Create: `fe-portal/src/components/layout/location-gate.tsx`
- Modify: `fe-portal/src/components/layout/admin-shell.tsx`

### Step 1: `location-filter-chips.tsx`

```tsx
"use client";
import { useEffect, useState } from "react";
import { locations as seedLocations } from "@/data";

type Props = {
  storageKey: string;
  value?: string | "all";
  onChange?: (v: string | "all") => void;
};

export function LocationFilterChips({ storageKey, value, onChange }: Props) {
  const active = seedLocations.filter((l) => !l.archivedAt);
  const [internal, setInternal] = useState<string | "all">("all");
  const current = value ?? internal;

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
    if (stored) {
      const v = stored as string | "all";
      if (!value) setInternal(v);
      onChange?.(v);
    }
  }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(next: string | "all") {
    if (!value) setInternal(next);
    onChange?.(next);
    if (typeof window !== "undefined") window.localStorage.setItem(storageKey, next);
  }

  if (active.length <= 1) {
    return (
      <div className="text-xs text-muted">All events at {active[0]?.name ?? "this studio"}</div>
    );
  }

  const chips: { id: string | "all"; label: string }[] = [
    { id: "all", label: "All locations" },
    ...active.map((l) => ({ id: l.id, label: l.name })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">Location</span>
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => set(c.id)}
          className={`rounded-full border px-3 py-1 text-xs transition ${
            current === c.id
              ? "border-accent bg-accent/10 text-ink"
              : "border-border bg-card text-muted hover:border-accent/40"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
```

### Step 2: `checkin-location-pill.tsx`

```tsx
"use client";
import { useEffect, useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { locations as seedLocations } from "@/data";

const STORAGE_KEY = "ys.checkinLocationId";

export function CheckinLocationPill({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string) => void;
}) {
  const active = seedLocations.filter((l) => !l.archivedAt);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (value) return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && active.some((l) => l.id === stored)) onChange(stored);
    else if (active[0]) onChange(active[0].id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const current = active.find((l) => l.id === value) ?? null;

  function commit(id: string) {
    window.localStorage.setItem(STORAGE_KEY, id);
    onChange(id);
    setPending(null);
    setOpen(false);
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:border-accent/40"
      >
        <MapPin className="h-3.5 w-3.5 text-muted" />
        <span className="font-medium text-ink">
          Checking in at: {current?.name ?? "Select a location"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-64 rounded-lg border border-border bg-card p-2 shadow-soft">
          {active.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => (l.id === value ? setOpen(false) : setPending(l.id))}
              className={`block w-full rounded px-3 py-2 text-left text-sm transition ${
                l.id === value ? "bg-paper text-ink" : "text-muted hover:bg-paper hover:text-ink"
              }`}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}
      {pending && (
        <div className="absolute z-40 mt-2 w-72 rounded-lg border border-border bg-card p-3 shadow-soft">
          <p className="mb-3 text-sm text-ink">
            Switch to <strong>{active.find((l) => l.id === pending)?.name}</strong>?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="rounded px-3 py-1.5 text-sm text-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => commit(pending)}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
            >
              Switch
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Step 3: `location-gate.tsx`

```tsx
"use client";
import { useState } from "react";
import { MapPin } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { locations as seedLocations } from "@/data";
import { LocationFormDialog } from "@/components/locations/location-form-dialog";
import type { Location } from "@/types";

export function LocationGate({ children }: { children: React.ReactNode }) {
  const [locations, setLocations] = useState<Location[]>(seedLocations);
  const [open, setOpen] = useState(false);
  const hasActive = locations.some((l) => !l.archivedAt);

  if (hasActive) return <>{children}</>;

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-lg rounded-2xl border border-border bg-card p-8 shadow-soft">
        <MapPin className="mb-4 h-8 w-8 text-accent" />
        <h2 className="mb-2 text-lg font-semibold text-ink">Add your first location</h2>
        <p className="mb-6 text-sm text-muted">
          The schedule, workshops, and check-in views all depend on at least one studio location.
          Add one to start configuring the rest of the system.
        </p>
        <Button onClick={() => setOpen(true)}>Add location</Button>
        {open && (
          <LocationFormDialog
            location={null}
            onSave={(loc) => {
              setLocations((prev) =>
                prev.some((l) => l.id === loc.id) ? prev.map((l) => (l.id === loc.id ? loc : l)) : [...prev, loc]
              );
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
```

### Step 4: Wire gate into `admin-shell.tsx`

Wrap the page-content area with `<LocationGate>`:

```tsx
import { LocationGate } from "./location-gate";
// inside the shell where {children} is rendered:
<LocationGate>{children}</LocationGate>
```

### Step 5: Smoke check + commit

- [ ] `pnpm exec tsc --noEmit` passes.
- [ ] Start `pnpm dev`; visit `/admin`. (Seed has locations, gate inactive.) Then temporarily archive both seed locations in `data/locations.ts` (don't commit this) — gate should render. Revert.
- [ ] Commit: `feat(fe-portal): per-page location chips, check-in pill, fresh-install gate`

---

## Task 4 — Class Types page (hierarchy + difficulty + description)

**Files:**
- Modify: `fe-portal/src/app/admin/class-types/page.tsx`

### Step 1: Replace dialog fields

Replace the existing `ClassTypeDialog` body with one that handles description, parent, difficulty. Maintain three fields below name:

```tsx
const [description, setDescription] = useState(ct?.description ?? "");
const [parentId, setParentId] = useState<string | null>(ct?.parentId ?? null);
const [difficulty, setDifficulty] = useState<ClassTypeDifficulty>(ct?.difficulty ?? "general");

// in submit:
onSave({
  id: ct?.id ?? `ct-${Date.now().toString(36)}`,
  name: name.trim(),
  description: description.trim(),
  parentId,
  difficulty,
  archivedAt: ct?.archivedAt ?? null,
});
```

Add JSX:

```tsx
<div className="space-y-1.5">
  <Label htmlFor="ct-desc">Description (optional)</Label>
  <textarea
    id="ct-desc"
    rows={3}
    maxLength={200}
    value={description}
    onChange={(e) => setDescription(e.target.value)}
    placeholder="Short description shown to clients."
    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
  />
</div>

<div className="space-y-1.5">
  <Label>Parent (optional)</Label>
  <select
    value={parentId ?? ""}
    onChange={(e) => setParentId(e.target.value || null)}
    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
  >
    <option value="">Top-level (no parent)</option>
    {parentOptions.map((p) => (
      <option key={p.id} value={p.id}>{p.name}</option>
    ))}
  </select>
</div>

<div className="space-y-1.5">
  <Label>Difficulty</Label>
  <div className="flex flex-wrap gap-2">
    {(["general", "beginner", "intermediate", "advanced"] as const).map((d) => (
      <button
        type="button"
        key={d}
        onClick={() => setDifficulty(d)}
        className={`rounded-full border px-3 py-1 text-xs ${
          difficulty === d ? "border-accent bg-accent/10" : "border-border bg-card text-muted"
        }`}
      >
        {d[0].toUpperCase() + d.slice(1)}
      </button>
    ))}
  </div>
</div>
```

`parentOptions` is computed in the dialog scope: `classTypes.filter(c => !c.archivedAt && c.parentId === null && c.id !== ct?.id)`. Pass `classTypes` down or import the prop from the page.

### Step 2: Render as 2-level tree

In `ClassTypesPage`, replace the flat `.map(active)` with a grouped render:

```tsx
const topLevel = active.filter((c) => c.parentId === null);
const childrenOf = (pid: string) => active.filter((c) => c.parentId === pid);

// render:
<ul ...>
  {topLevel.map((ct) => (
    <Fragment key={ct.id}>
      <ClassTypeRow ct={ct} onEdit={...} onArchive={...} />
      {childrenOf(ct.id).map((child) => (
        <ClassTypeRow key={child.id} ct={child} indent onEdit={...} onArchive={...} />
      ))}
    </Fragment>
  ))}
</ul>
```

Update `ClassTypeRow` to accept `indent?: boolean` and render `pl-9` (instead of `pl-4`) plus a vertical guide `border-l border-border`.

### Step 3: Show difficulty pill + description tooltip in the row

```tsx
<span className="text-sm font-medium text-ink">{ct.name}</span>
<span className="rounded-full bg-paper px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
  {ct.difficulty}
</span>
{ct.description && (
  <span className="hidden truncate text-xs text-muted sm:inline-block max-w-[40ch]" title={ct.description}>
    {ct.description}
  </span>
)}
```

### Step 4: Smoke + commit

- [ ] Visit `/admin/class-types`. Aerial Foundations and Aerial Flow render indented under Aerial Yoga. Create a new class type with description + parent + difficulty; reappears as expected.
- [ ] Commit: `feat(fe-portal): class types hierarchy + description + difficulty`

---

## Task 5 — Shared `<PromotionsEditor />` + `<CapacityFields />`

**Files:**
- Create: `fe-portal/src/components/packages/promotions-editor.tsx`
- Create: `fe-portal/src/components/schedule/capacity-fields.tsx`

### Step 1: `capacity-fields.tsx`

```tsx
"use client";
import { Label } from "@/components/ui";
import { maxCapacity } from "@/lib/capacity";
import type { Capacity } from "@/types";

export function CapacityFields({
  value,
  onChange,
}: {
  value: Capacity;
  onChange: (next: Capacity) => void;
}) {
  function set(key: keyof Capacity, raw: string) {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    onChange({ ...value, [key]: n });
  }
  return (
    <div className="rounded-lg border border-border bg-paper p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Capacity</div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Waitlist" value={value.waitlist} onChange={(v) => set("waitlist", v)} />
        <Field label="Online booking" value={value.onlineBooking} onChange={(v) => set("onlineBooking", v)} />
        <Field label="Buffer" value={value.buffer} onChange={(v) => set("buffer", v)} />
      </div>
      <div className="mt-3 border-t border-border pt-3 text-sm">
        <span className="text-muted">Max capacity: </span>
        <span className="font-semibold text-ink">{maxCapacity(value)}</span>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
      />
    </div>
  );
}
```

### Step 2: `promotions-editor.tsx`

```tsx
"use client";
import { Plus, Trash2 } from "lucide-react";
import { Button, Label } from "@/components/ui";
import type { Promotion, PromotionMode } from "@/types";

const QUICK_PERCENTS = [10, 25, 50];

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
    const start = today.toISOString().slice(0, 10);
    const end = new Date(today.getTime() + 14 * 86400_000).toISOString().slice(0, 10);
    onChange([
      ...value,
      {
        id: `promo-${Date.now().toString(36)}`,
        label: "",
        mode: "percent",
        percent: 10,
        priceSgd: null,
        startsAt: `${start}T00:00:00.000Z`,
        endsAt: `${end}T23:59:59.000Z`,
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
    if (p.mode === "percent" && p.percent !== null) return Math.round(basePriceSgd * (1 - p.percent / 100));
    if (p.mode === "price" && p.priceSgd !== null) return p.priceSgd;
    return basePriceSgd;
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">Promotions</div>
      {value.length === 0 && <div className="text-xs text-muted">No promotions.</div>}
      {value.map((p) => (
        <div key={p.id} className="space-y-3 rounded-lg border border-border bg-paper p-3">
          <div className="flex gap-2">
            <input
              value={p.label}
              onChange={(e) => update(p.id, { label: e.target.value })}
              placeholder="e.g. CNY Promo"
              className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm"
            />
            <button type="button" onClick={() => remove(p.id)} className="rounded p-2 text-muted hover:text-error">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="flex gap-2">
            {(["percent", "price"] as PromotionMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => update(p.id, { mode: m, percent: m === "percent" ? 10 : null, priceSgd: m === "price" ? 0 : null })}
                className={`rounded-full border px-3 py-1 text-xs ${
                  p.mode === m ? "border-accent bg-accent/10" : "border-border bg-card text-muted"
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
                onChange={(e) => update(p.id, { percent: Math.max(1, Math.min(99, Number(e.target.value) || 0)) })}
                className="w-20 rounded-md border border-border bg-card px-2 py-1 text-sm"
              />
              <span className="text-xs text-muted">%</span>
            </div>
          ) : (
            <input
              type="number"
              min={0}
              value={p.priceSgd ?? 0}
              onChange={(e) => update(p.id, { priceSgd: Math.max(0, Number(e.target.value) || 0) })}
              placeholder="Special price SGD"
              className="w-40 rounded-md border border-border bg-card px-3 py-2 text-sm"
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Starts</Label>
              <input
                type="date"
                value={p.startsAt.slice(0, 10)}
                onChange={(e) => update(p.id, { startsAt: `${e.target.value}T00:00:00.000Z` })}
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ends</Label>
              <input
                type="date"
                value={p.endsAt.slice(0, 10)}
                onChange={(e) => update(p.id, { endsAt: `${e.target.value}T23:59:59.000Z` })}
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
```

### Step 3: Compile + commit

- [ ] `pnpm exec tsc --noEmit` passes.
- [ ] Commit: `feat(fe-portal): shared <CapacityFields /> + <PromotionsEditor />`

---

## Task 6 — Class Packages page: trial section + promotions in dialog

**Files:**
- Modify: `fe-portal/src/components/packages/class-package-dialog.tsx`
- Modify: `fe-portal/src/app/admin/classes/page.tsx`

### Step 1: Dialog — add `trial` kind tab, description field, promotions section

Extend the `kind` segmented control to include `"trial"`. In the trial branch, render:
- `Description` textarea (required for trial, optional otherwise).
- `Class quota` numeric input → maps to `credits`.
- `Validity in days (optional)` → maps to `validityDays`.
- Hide `durationDays`.

For all kinds, render `<PromotionsEditor basePriceSgd={Number(priceSgd) || 0} value={promotions} onChange={setPromotions} />` at the bottom.

In the submit handler:

```ts
{
  id, name, kind, priceSgd: Number(priceSgd),
  description: description.trim(),
  credits: kind === "credit_bundle" || kind === "trial" ? Number(credits) : null,
  validityDays: kind === "credit_bundle" ? Number(validityDays)
              : kind === "trial" ? (validityDays ? Number(validityDays) : null) : null,
  durationDays: kind === "unlimited" ? Number(durationDays) : null,
  status: pkg?.status ?? "active",
  promotions,
}
```

### Step 2: Classes page — add Trial section, active-promo pill on rows

Filter into three groups: `trial`, `credit_bundle`, `unlimited`. Render Trial first with a one-active warning if `>1`. Helper text under the Trial section header: *"A one-time-only introductory pass. Each client can purchase at most one."*

On each row, compute `getActivePromotion(pkg)` and render a small pill:

```tsx
const promo = getActivePromotion(pkg);
const future = !promo && pkg.promotions.find((p) => new Date(p.startsAt) > new Date());
{promo && (
  <span className="rounded-full bg-sage/15 px-2 py-0.5 text-[10px] uppercase text-sage">
    Promo · {promo.mode === "percent" ? `-${promo.percent}%` : `S$${promo.priceSgd}`}
  </span>
)}
{!promo && future && (
  <span className="rounded-full bg-paper px-2 py-0.5 text-[10px] uppercase text-muted">
    Promo · starts {new Date(future.startsAt).toLocaleDateString()}
  </span>
)}
```

### Step 3: Smoke + commit

- [ ] Visit `/admin/classes`. See Trial section at top with the seeded Trial Pass. Bundle of 20 row shows the `Promo · -25%` pill. Open its dialog → Promotions section shows the seeded CNY Promo, can edit.
- [ ] Commit: `feat(fe-portal): trial pass + promotions in /admin/classes`

---

## Task 7 — Private Sessions page: promotions in dialog

**Files:**
- Modify: `fe-portal/src/components/packages/pt-package-dialog.tsx` (or wherever it lives — if PT uses an inline dialog inside `private-sessions/page.tsx`, edit that instead)
- Modify: `fe-portal/src/app/admin/private-sessions/page.tsx`

### Step 1: Add `<PromotionsEditor />` slot in the PT dialog

Same pattern as Task 6 Step 1, but PtPackage doesn't need a kind change. Include the existing fields + `promotions` state.

### Step 2: Active-promo pill on PT rows

Mirror Task 6 Step 2's pill code on the PT package list.

### Step 3: Smoke + commit

- [ ] Visit `/admin/private-sessions`. Edit any PT package; Promotions section appears. Add a 10% promo with dates spanning today; row pill appears.
- [ ] Commit: `feat(fe-portal): promotions on PT packages`

---

## Task 8 — Workshops nav + list page

**Files:**
- Modify: `fe-portal/src/components/layout/nav-items.ts`
- Create: `fe-portal/src/app/admin/packages/workshops/page.tsx`

### Step 1: nav — add Workshops, remove Availability

In `nav-items.ts`, after `Private Sessions` insert:

```ts
{ group: "Packages", label: "Workshops", href: "/admin/packages/workshops", icon: Sparkles },
```

(Import `Sparkles` from `lucide-react`.)

Delete:

```ts
{ group: "Schedule", label: "Availability", href: "/admin/availability", icon: Clock },
```

### Step 2: `/admin/packages/workshops/page.tsx`

Render a list of workshops grouped by lifecycle (Upcoming / In progress / Past / Cancelled). Use `workshop.days[0].date` to derive status.

```tsx
"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus, MapPin } from "lucide-react";
import { Button, PageHeader, Badge, EmptyState } from "@/components/ui";
import { workshops as seedWorkshops, locations, classTypes } from "@/data";
import { LocationFilterChips } from "@/components/locations/location-filter-chips";
import type { Workshop } from "@/types";

function statusOf(w: Workshop): "upcoming" | "in_progress" | "past" | "cancelled" {
  if (w.lifecycle === "cancelled") return "cancelled";
  const today = new Date().toISOString().slice(0, 10);
  const first = w.days[0]?.date ?? today;
  const last = w.days[w.days.length - 1]?.date ?? today;
  if (last < today) return "past";
  if (first <= today && today <= last) return "in_progress";
  return "upcoming";
}

function dateRangeLabel(w: Workshop): string {
  if (w.days.length === 0) return "No dates";
  if (w.days.length === 1) return new Date(w.days[0].date).toLocaleDateString();
  return w.days.map((d) => new Date(d.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })).join(" · ");
}

export default function WorkshopsListPage() {
  const [filter, setFilter] = useState<string | "all">("all");
  const filtered = seedWorkshops.filter((w) => filter === "all" || w.locationId === filter);
  const upcoming = filtered.filter((w) => statusOf(w) === "upcoming");
  const inProgress = filtered.filter((w) => statusOf(w) === "in_progress");
  const past = filtered.filter((w) => statusOf(w) === "past");
  const cancelled = filtered.filter((w) => statusOf(w) === "cancelled");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Workshops"
        description="Configure upcoming workshops. Each day appears on the schedule automatically once configured."
        actions={
          <Link href="/admin/packages/workshops/new">
            <Button>
              <Plus className="h-4 w-4" /> New workshop
            </Button>
          </Link>
        }
      />
      <LocationFilterChips storageKey="ys.workshopsLocationFilter" value={filter} onChange={setFilter} />

      {filtered.length === 0 && (
        <EmptyState
          title="No workshops yet"
          description="Create one to see it appear on the schedule."
          cta={
            <Link href="/admin/packages/workshops/new">
              <Button>
                <Plus className="h-4 w-4" /> New workshop
              </Button>
            </Link>
          }
        />
      )}

      {inProgress.length > 0 && <Section title="In progress" workshops={inProgress} />}
      {upcoming.length > 0 && <Section title="Upcoming" workshops={upcoming} />}
      {past.length > 0 && <details><summary className="cursor-pointer text-sm text-muted">Past ({past.length})</summary><Section title="" workshops={past} /></details>}
      {cancelled.length > 0 && <details><summary className="cursor-pointer text-sm text-muted">Cancelled ({cancelled.length})</summary><Section title="" workshops={cancelled} /></details>}
    </div>
  );
}

function Section({ title, workshops }: { title: string; workshops: Workshop[] }) {
  return (
    <div className="space-y-2">
      {title && <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h2>}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-soft">
        {workshops.map((w) => (
          <li key={w.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <Link href={`/admin/packages/workshops/${w.id}/edit`} className="font-medium text-ink hover:text-accent">
                {w.name}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge tone="accent">{classTypes.find((c) => c.id === w.classTypeId)?.name ?? "—"}</Badge>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {locations.find((l) => l.id === w.locationId)?.name ?? "—"}
                </span>
                <span>·</span>
                <span>{dateRangeLabel(w)}</span>
                <span>·</span>
                <span>{w.days.length} day{w.days.length > 1 ? "s" : ""}</span>
                <span>·</span>
                <span>{w.tiers.length} tier{w.tiers.length > 1 ? "s" : ""}</span>
              </div>
            </div>
            <Link href={`/admin/packages/workshops/${w.id}/edit`}>
              <Button size="sm" variant="ghost">Edit</Button>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Step 3: Smoke + commit

- [ ] Visit `/admin/packages/workshops`. Seeded workshops list. Switch chip → filter narrows. `/admin/availability` returns 404.
- [ ] Commit: `feat(fe-portal): Packages → Workshops nav + list page; remove Availability nav`

---

## Task 9 — Workshop editor (three-stage form)

**Files:**
- Create: `fe-portal/src/components/workshops/workshop-editor.tsx`
- Create: `fe-portal/src/components/workshops/workshop-days-editor.tsx`
- Create: `fe-portal/src/components/workshops/workshop-tiers-editor.tsx`
- Create: `fe-portal/src/app/admin/packages/workshops/new/page.tsx`
- Create: `fe-portal/src/app/admin/packages/workshops/[id]/edit/page.tsx`

### Step 1: `workshop-days-editor.tsx`

Render a toggle `Date range` / `Individual dates`. In range mode, two date inputs auto-expand to days when both filled. In individual mode, `+ Add date` button. Each `WorkshopDay` row inline-edits date (locked in range mode), start/end time, `<CapacityFields />`, base price.

Keep state shape: `{ mode: "range" | "individual"; days: WorkshopDay[]; rangeStart?: string; rangeEnd?: string }`. Parent owns `days[]`; this component dispatches `onChange(days)`.

Helper to generate days when range changes:

```ts
function expandRange(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  for (let d = s; d <= e; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
```

### Step 2: `workshop-tiers-editor.tsx`

Disabled (with helper text) until `days.length > 0`. Otherwise renders tier cards with: name, description, day-checkbox grid (label each `Day N · D Mmm`, plus an `All days` toggle), bundled price, optional early-bird price + cutoff datetime. `+ Add tier` appends.

Per-tier validation banner inline:
- "Tier needs at least one day."
- "Early-bird price must be lower than the tier price." (when both set)

### Step 3: `workshop-editor.tsx`

Combines: basics fields + `<WorkshopDaysEditor />` + `<WorkshopTiersEditor />`. Save handler validates: ≥ 1 day, every day complete, ≥ 1 tier, every tier valid; on pass, calls `onSave(workshop)`.

```tsx
export function WorkshopEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: Workshop | null;
  onSave: (w: Workshop) => void;
  onCancel: () => void;
}) {
  // local state for name, classTypeId, locationId, instructorIds, descriptionHtml, coverUrl, days, tiers
  // useState seeded from `initial` or blank defaults.
  // submit → onSave({ id: initial?.id ?? `ws-${Date.now().toString(36)}`, ..., lifecycle: initial?.lifecycle ?? "active", cancelledAt: null, cancelledByStaffId: null });
}
```

### Step 4: `new/page.tsx` + `[id]/edit/page.tsx`

`new/page.tsx`:
```tsx
"use client";
import { useRouter } from "next/navigation";
import { WorkshopEditor } from "@/components/workshops/workshop-editor";

export default function NewWorkshopPage() {
  const router = useRouter();
  return (
    <WorkshopEditor
      initial={null}
      onCancel={() => router.push("/admin/packages/workshops")}
      onSave={() => router.push("/admin/packages/workshops")}
    />
  );
}
```

`[id]/edit/page.tsx`:
```tsx
"use client";
import { useParams, useRouter } from "next/navigation";
import { workshops } from "@/data";
import { WorkshopEditor } from "@/components/workshops/workshop-editor";

export default function EditWorkshopPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const initial = workshops.find((w) => w.id === id) ?? null;
  if (!initial) return <div className="p-6">Workshop not found.</div>;
  return (
    <WorkshopEditor
      initial={initial}
      onCancel={() => router.push("/admin/packages/workshops")}
      onSave={() => router.push("/admin/packages/workshops")}
    />
  );
}
```

### Step 5: Delete the legacy workshop form

Delete `fe-portal/src/app/admin/schedule/new/workshop/page.tsx`. Add a redirect file in its place:

```tsx
// fe-portal/src/app/admin/schedule/new/workshop/page.tsx
import { redirect } from "next/navigation";
export default function Page() {
  redirect("/admin/packages/workshops/new");
}
```

### Step 6: Smoke + commit

- [ ] Visit `/admin/packages/workshops/new`. Three sections render. Without days, tier section shows the disabled helper. Set 3-day range → 3 day rows appear. Switch to Individual → can remove/add specific dates. Tier section enables; create "Full Event" tier toggling `All days`, set price + early-bird; Save returns to list.
- [ ] Edit the seeded Weekend Aerial Intensive; verify days + tiers prefill correctly.
- [ ] Old route `/admin/schedule/new/workshop` redirects to the new path.
- [ ] Commit: `feat(fe-portal): three-stage workshop editor (basics / days / tiers)`

---

## Task 10 — Client profile: kebab + expiry + set-balance dialogs

**Files:**
- Create: `fe-portal/src/components/clients/package-expiry-dialog.tsx`
- Create: `fe-portal/src/components/clients/package-set-balance-dialog.tsx`
- Modify: `fe-portal/src/components/clients/client-profile-client.tsx`

### Step 1: Expiry dialog

```tsx
"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import type { ClientPackage } from "@/types";

export function PackageExpiryDialog({
  pkg, onSave, onClose,
}: {
  pkg: ClientPackage;
  onSave: (newExpiresAt: string | null, reason: string) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(pkg.expiresAt?.slice(0, 10) ?? "");
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Edit expiry — ${pkg.packageName}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) return;
          onSave(date ? `${date}T23:59:59.000Z` : null, reason.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="exp-date">New expiry date</Label>
          <Input id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exp-reason">Reason (required)</Label>
          <textarea
            id="exp-reason" rows={3} required value={reason} onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
```

### Step 2: Set-balance dialog

```tsx
"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import type { ClientPackage } from "@/types";

export function PackageSetBalanceDialog({
  pkg, onSave, onClose,
}: {
  pkg: ClientPackage;
  onSave: (newBalance: number, reason: string) => void;
  onClose: () => void;
}) {
  const [balance, setBalance] = useState<string>(String(pkg.creditsOrSessionsRemaining ?? 0));
  const [reason, setReason] = useState("");
  const current = pkg.creditsOrSessionsRemaining ?? 0;
  const newVal = Math.max(0, Number(balance) || 0);
  const delta = newVal - current;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Set credit balance — ${pkg.packageName}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (delta === 0 || !reason.trim()) return;
          onSave(newVal, reason.trim());
        }}
      >
        <div className="text-sm text-muted">Current balance: <strong className="text-ink">{current}</strong></div>
        <div className="space-y-1.5">
          <Label htmlFor="bal">New balance</Label>
          <Input id="bal" type="number" min={0} value={balance} onChange={(e) => setBalance(e.target.value)} />
          <div className="text-xs text-muted">Delta: {delta >= 0 ? `+${delta}` : delta}</div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bal-reason">Reason (required)</Label>
          <textarea
            id="bal-reason" rows={3} required value={reason} onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={delta === 0 || !reason.trim()}>Save</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
```

### Step 3: Wire kebab into `client-profile-client.tsx`

Inside each package row, add a kebab menu with three options:
- **Set credit balance** (only when `kind === "credit_bundle"`)
- **Edit expiry** (when `kind === "credit_bundle"` or `kind === "unlimited"`)
- **Manual adjustment** (existing flow, only credit_bundle)

Replace the standalone section-header "Manual adjustment" button. The kebab callbacks update local state and append a `ManualAdjustment` row (delta = 0 with the reason text for expiry; computed delta for set-balance; arbitrary delta for adjustment).

Render the audit list with tone-coded badges per Task spec §4: neutral `Expiry`, accent `Set`, sage/error `+N`/`-N`. Distinguish in the badge from `reason.startsWith("Expiry")` vs `reason.startsWith("Set ")`.

### Step 4: Smoke + commit

- [ ] Visit `/admin/clients/<id>` for a client with an active credit_bundle. Open the row kebab → "Set credit balance" → enter 999 with reason → balance updates, ledger row appears. Try "Edit expiry" on credit_bundle and unlimited.
- [ ] Trial packages render with a "Trial" badge in the active packages list.
- [ ] Commit: `feat(fe-portal): per-row kebab with set-balance and edit-expiry dialogs on client profile`

---

## Task 11 — PT Requests page + drawer + dialogs

**Files:**
- Create: `fe-portal/src/app/admin/pt-requests/page.tsx`
- Create: `fe-portal/src/components/pt-requests/pt-request-drawer.tsx`
- Create: `fe-portal/src/components/pt-requests/schedule-from-request-dialog.tsx`
- Create: `fe-portal/src/components/pt-requests/decline-request-dialog.tsx`
- Modify: `fe-portal/src/components/layout/nav-items.ts`
- Modify: `fe-portal/src/app/admin/inbox/page.tsx` (drop pt_request)

### Step 1: nav entry

Above `Inbox` in the Operations group:

```ts
{ group: "Operations", label: "PT Requests", href: "/admin/pt-requests", icon: HandHeart, badgeKey: "ptRequestsPending" },
```

(Import `HandHeart` from `lucide-react`.) Register `ptRequestsPending` in wherever badge counts are computed (likely `admin-shell.tsx` or `admin-nav.tsx`); compute as `ptRequests.filter(r => r.status === "pending").length`.

### Step 2: Inbox cleanup

In `app/admin/inbox/page.tsx`, drop `pt_request` from `TYPE_LABELS` and filter chips. Remove the related "decline note" UI if it was wired exclusively for pt_request.

### Step 3: `schedule-from-request-dialog.tsx`

```tsx
"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { instructors, locations } from "@/data";
import { CapacityFields } from "@/components/schedule/capacity-fields";
import type { Capacity, PtRequest } from "@/types";

export function ScheduleFromRequestDialog({
  request, onConfirm, onClose,
}: {
  request: PtRequest;
  onConfirm: (payload: {
    date: string; startTime: string; durationMinutes: number;
    instructorId: string; locationId: string; capacity: Capacity;
  }) => void;
  onClose: () => void;
}) {
  const first = request.preferredSlots[0];
  const [date, setDate] = useState(first.date);
  const [startTime, setStartTime] = useState(first.startTime);
  const [duration, setDuration] = useState(request.durationMinutes);
  const [instructorId, setInstructorId] = useState(request.preferredInstructorId ?? instructors[0]?.id ?? "");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [capacity, setCapacity] = useState<Capacity>(
    request.sessionType === "1on1"
      ? { waitlist: 0, onlineBooking: 1, buffer: 0 }
      : { waitlist: 0, onlineBooking: 2, buffer: 0 }
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Schedule PT session">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm({ date, startTime, durationMinutes: duration, instructorId, locationId, capacity });
        }}
      >
        {request.preferredSlots.length > 1 && (
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-muted">Preferred slots:</span>
            {request.preferredSlots.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { setDate(s.date); setStartTime(s.startTime); }}
                className="rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:border-accent/40"
              >
                {s.date} · {s.startTime}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Start time</Label><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Duration (min)</Label><Input type="number" min={30} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></div>
          <div className="space-y-1.5">
            <Label>Instructor</Label>
            <select value={instructorId} onChange={(e) => setInstructorId(e.target.value)} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm">
              {instructors.filter((i) => !i.archivedAt).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Location</Label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm">
              {locations.filter((l) => !l.archivedAt).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <CapacityFields value={capacity} onChange={setCapacity} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit">Schedule session</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
```

### Step 4: `decline-request-dialog.tsx`

```tsx
"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Label } from "@/components/ui";

export function DeclineRequestDialog({
  onConfirm, onClose,
}: {
  onConfirm: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Decline PT request">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (note.trim().length >= 5) onConfirm(note.trim()); }}>
        <div className="space-y-1.5">
          <Label>Reason (visible to client, ≥ 5 characters)</Label>
          <textarea rows={4} required minLength={5} value={note} onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm" />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={note.trim().length < 5}>Decline request</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
```

### Step 5: `pt-request-drawer.tsx`

Detail drawer reused from both entry points. Props: `request`, `onSchedule`, `onDecline`, `onClose`. Renders client info, preferred slots list, session type, duration, instructor preference, client note, current status. When pending, shows Schedule + Decline buttons; otherwise renders outcome card.

```tsx
"use client";
import { clients, instructors } from "@/data";
import { Button, Badge } from "@/components/ui";
import { formatDateTime, formatRelative } from "@/lib/formatters";
import type { PtRequest } from "@/types";

export function PtRequestDrawer({
  request, onSchedule, onDecline, onClose,
}: {
  request: PtRequest;
  onSchedule: () => void;
  onDecline: () => void;
  onClose: () => void;
}) {
  const client = clients.find((c) => c.id === request.clientId);
  const instructor = request.preferredInstructorId ? instructors.find((i) => i.id === request.preferredInstructorId) : null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-50 h-full w-full max-w-md overflow-y-auto bg-card p-6 shadow-xl">
        <button onClick={onClose} className="absolute right-4 top-4 text-muted hover:text-ink">✕</button>
        <h2 className="text-base font-semibold text-ink">{client?.fullName ?? "Unknown client"}</h2>
        <div className="mt-1 text-xs text-muted">Submitted {formatRelative(request.createdAt)}</div>
        <div className="mt-4 space-y-3 text-sm">
          <div><span className="text-muted">Session: </span>{request.sessionType.toUpperCase()} · {request.durationMinutes} min</div>
          <div><span className="text-muted">Instructor preference: </span>{instructor?.name ?? "Any"}</div>
          <div>
            <div className="text-muted">Preferred slots:</div>
            <ul className="mt-1 space-y-1">
              {request.preferredSlots.map((s, i) => <li key={i} className="text-ink">{s.date} · {s.startTime}</li>)}
            </ul>
          </div>
          {request.clientNote && (
            <blockquote className="rounded-md border-l-2 border-border bg-paper p-3 text-sm italic">{request.clientNote}</blockquote>
          )}
          <div><Badge tone={request.status === "pending" ? "accent" : request.status === "scheduled" ? "sage" : "error"}>{request.status}</Badge></div>
        </div>
        {request.status === "pending" ? (
          <div className="mt-6 flex gap-2">
            <Button onClick={onSchedule}>Schedule</Button>
            <Button variant="ghost" onClick={onDecline}>Decline</Button>
          </div>
        ) : (
          <div className="mt-6 rounded-md bg-paper p-3 text-xs text-muted">
            {request.status === "scheduled" && <>Scheduled on {formatDateTime(request.decidedAt ?? "")}.</>}
            {request.status === "declined" && (
              <>Declined on {formatDateTime(request.decidedAt ?? "")} — “{request.declineNote}”.</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 6: `pt-requests/page.tsx`

```tsx
"use client";
import { useState } from "react";
import { PageHeader, Badge } from "@/components/ui";
import { ptRequests as seedRequests, clients, instructors, ptSessions as seedSessions } from "@/data";
import { PtRequestDrawer } from "@/components/pt-requests/pt-request-drawer";
import { ScheduleFromRequestDialog } from "@/components/pt-requests/schedule-from-request-dialog";
import { DeclineRequestDialog } from "@/components/pt-requests/decline-request-dialog";
import type { PtRequest, PtSession } from "@/types";

type Filter = "pending" | "scheduled" | "declined" | "all";

export default function PtRequestsPage() {
  const [requests, setRequests] = useState<PtRequest[]>(seedRequests);
  const [sessions, setSessions] = useState<PtSession[]>(seedSessions);
  const [tab, setTab] = useState<Filter>("pending");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [schedFor, setSchedFor] = useState<PtRequest | null>(null);
  const [declineFor, setDeclineFor] = useState<PtRequest | null>(null);

  const filtered = requests.filter((r) => tab === "all" || r.status === tab).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = requests.find((r) => r.id === activeId) ?? null;

  function applySchedule(req: PtRequest, payload: { date: string; startTime: string; durationMinutes: number; instructorId: string; locationId: string; capacity: PtSession["capacity"] }) {
    const startsAt = `${payload.date}T${payload.startTime}:00.000Z`;
    const endsAt = new Date(new Date(startsAt).getTime() + payload.durationMinutes * 60_000).toISOString();
    const session: PtSession = {
      id: `pts-${Date.now().toString(36)}`,
      instructorId: payload.instructorId,
      locationId: payload.locationId,
      startsAt, endsAt,
      sessionType: req.sessionType,
      capacity: payload.capacity,
      lifecycle: "active",
      cancelledAt: null,
      cancelledByStaffId: null,
    } as unknown as PtSession;
    setSessions((prev) => [...prev, session]);
    setRequests((prev) => prev.map((r) => r.id === req.id ? { ...r, status: "scheduled", ptSessionId: session.id, decidedByStaffId: "staff-1", decidedAt: new Date().toISOString() } : r));
    setSchedFor(null);
    setActiveId(null);
  }

  function applyDecline(req: PtRequest, note: string) {
    setRequests((prev) => prev.map((r) => r.id === req.id ? { ...r, status: "declined", declineNote: note, decidedByStaffId: "staff-1", decidedAt: new Date().toISOString() } : r));
    setDeclineFor(null);
    setActiveId(null);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="PT Requests" description="Triage client-submitted private session requests. Schedule, or decline with a reason." />
      <div className="flex gap-2">
        {(["pending", "scheduled", "declined", "all"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setTab(f)} className={`rounded-full border px-3 py-1 text-xs ${tab === f ? "border-accent bg-accent/10" : "border-border bg-card text-muted"}`}>
            {f[0].toUpperCase() + f.slice(1)}
            {f === "pending" && (() => { const n = requests.filter((r) => r.status === "pending").length; return n ? ` (${n})` : ""; })()}
          </button>
        ))}
      </div>

      {filtered.length === 0 && <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted">No requests in this view.</div>}

      <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-soft">
        {filtered.map((r) => {
          const client = clients.find((c) => c.id === r.clientId);
          const instructor = r.preferredInstructorId ? instructors.find((i) => i.id === r.preferredInstructorId) : null;
          return (
            <li key={r.id}>
              <button onClick={() => setActiveId(r.id)} className="block w-full px-4 py-3 text-left hover:bg-paper">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-ink">{client?.fullName ?? "—"}</div>
                    <div className="text-xs text-muted">
                      {r.sessionType.toUpperCase()} · {r.durationMinutes} min · {instructor?.name ?? "Any instructor"} · {r.preferredSlots[0].date} {r.preferredSlots[0].startTime}{r.preferredSlots.length > 1 ? ` +${r.preferredSlots.length - 1} more` : ""}
                    </div>
                  </div>
                  <Badge tone={r.status === "pending" ? "accent" : r.status === "scheduled" ? "sage" : "error"}>{r.status}</Badge>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {active && (
        <PtRequestDrawer
          request={active}
          onClose={() => setActiveId(null)}
          onSchedule={() => setSchedFor(active)}
          onDecline={() => setDeclineFor(active)}
        />
      )}
      {schedFor && (
        <ScheduleFromRequestDialog
          request={schedFor}
          onClose={() => setSchedFor(null)}
          onConfirm={(payload) => applySchedule(schedFor, payload)}
        />
      )}
      {declineFor && (
        <DeclineRequestDialog
          onClose={() => setDeclineFor(null)}
          onConfirm={(note) => applyDecline(declineFor, note)}
        />
      )}
    </div>
  );
}
```

### Step 7: Smoke + commit

- [ ] Visit `/admin/pt-requests`. Filter chips work; nav badge shows pending count. Open a pending request → drawer → Schedule → fill dialog → confirm. Status flips to `Scheduled`, drawer's outcome card appears. Open another → Decline with a note. Both terminal states render correctly. The declined seed request shows the existing note inline.
- [ ] Commit: `feat(fe-portal): PT Requests page with schedule/decline actions`

---

## Task 12 — Schedule page: capacity, workshop dropdown, +PT button, per-day tiles, location chips

**Files:**
- Modify: `fe-portal/src/app/admin/schedule/page.tsx`
- Modify: `fe-portal/src/app/admin/schedule/new/class/page.tsx`
- Modify: `fe-portal/src/app/admin/schedule/[type]/[id]/page.tsx`
- Modify: `fe-portal/src/components/schedule/workshop-detail-client.tsx`
- Create: `fe-portal/src/components/schedule/workshop-picker-dropdown.tsx`
- Create: `fe-portal/src/components/schedule/pt-request-picker-dialog.tsx`

### Step 1: New-class form → use `<CapacityFields />`

In `app/admin/schedule/new/class/page.tsx`, replace the single capacity input with state:

```tsx
import { CapacityFields } from "@/components/schedule/capacity-fields";
const [capacity, setCapacity] = useState({ waitlist: 0, onlineBooking: 18, buffer: 2 });
// in JSX:
<CapacityFields value={capacity} onChange={setCapacity} />
```

Save flow stores `capacity` as the object.

### Step 2: Workshop picker dropdown

`workshop-picker-dropdown.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { workshops } from "@/data";

export function WorkshopPickerDropdown() {
  const [open, setOpen] = useState(false);
  const active = workshops.filter((w) => w.lifecycle === "active");
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:border-accent/40">
        Workshop <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-lg border border-border bg-card p-2 shadow-soft">
          {active.length === 0 && <div className="px-3 py-2 text-xs text-muted">No workshops configured.</div>}
          {active.map((w) => (
            <Link key={w.id} href={`/admin/packages/workshops/${w.id}/edit`} className="block rounded px-3 py-2 text-sm hover:bg-paper">
              {w.name}
            </Link>
          ))}
          <div className="mt-1 border-t border-border pt-1">
            <Link href="/admin/packages/workshops/new" className="inline-flex items-center gap-1 rounded px-3 py-2 text-sm text-accent hover:bg-paper">
              <Plus className="h-3.5 w-3.5" /> New workshop
            </Link>
            <Link href="/admin/packages/workshops" className="block rounded px-3 py-2 text-xs text-muted hover:bg-paper">Manage workshops →</Link>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Step 3: PT request picker dialog

```tsx
"use client";
import { useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { clients, instructors, ptRequests as seedReqs } from "@/data";
import { ScheduleFromRequestDialog } from "@/components/pt-requests/schedule-from-request-dialog";
import type { PtRequest } from "@/types";

export function PtRequestPickerDialog({
  onClose, onScheduled,
}: {
  onClose: () => void;
  onScheduled: (req: PtRequest, payload: Parameters<Parameters<typeof ScheduleFromRequestDialog>[0]["onConfirm"]>[0]) => void;
}) {
  const pending = seedReqs.filter((r) => r.status === "pending").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [picked, setPicked] = useState<PtRequest | null>(null);

  if (picked) {
    return (
      <ScheduleFromRequestDialog
        request={picked}
        onClose={() => setPicked(null)}
        onConfirm={(payload) => { onScheduled(picked, payload); }}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Schedule a pending PT request">
      {pending.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">No pending PT requests. Clients submit requests from their app.</p>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {pending.map((r) => {
            const client = clients.find((c) => c.id === r.clientId);
            const instructor = r.preferredInstructorId ? instructors.find((i) => i.id === r.preferredInstructorId) : null;
            return (
              <li key={r.id}>
                <button onClick={() => setPicked(r)} className="block w-full px-3 py-2 text-left hover:bg-paper">
                  <div className="text-sm font-medium text-ink">{client?.fullName ?? "—"}</div>
                  <div className="text-xs text-muted">
                    {r.sessionType.toUpperCase()} · {r.durationMinutes} min · {instructor?.name ?? "Any"} · {r.preferredSlots[0].date} {r.preferredSlots[0].startTime}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
```

### Step 4: Schedule page — swap CTAs, add chips, per-day workshop tiles

In `app/admin/schedule/page.tsx`:

1. Remove the `+ Workshop` link; replace with `<WorkshopPickerDropdown />`.
2. Add a `+ PT Session` button with pending-count badge that opens `<PtRequestPickerDialog />`.
3. Add `<LocationFilterChips storageKey="ys.scheduleLocationFilter" />` above the timetable.
4. Where workshop tiles are rendered, iterate `workshop.days[]` and emit one tile per day with a `Day N/M` chip when `days.length > 1`. Workshop tile date/time comes from the day, not from `workshop.startsAt` (which no longer exists).
5. Filter timetable rows by selected location chip when non-`all`.

Use `maxCapacity(event.capacity)` wherever the previous code used `event.capacity` for display.

### Step 5: Schedule detail page — Edit reroute + capacity breakdown

In `app/admin/schedule/[type]/[id]/page.tsx`:
- When `type === "workshop"`, the Edit button routes to `/admin/packages/workshops/[id]/edit`.
- Add a "Capacity breakdown" sub-section displaying waitlist/onlineBooking/buffer with their max.

### Step 6: Smoke + commit

- [ ] Visit `/admin/schedule`. The `+ Workshop` is a dropdown listing configured workshops. The `+ PT Session` button shows a pending count. Clicking it opens picker; selecting a pending request opens the schedule dialog; confirm → tile appears on the timetable.
- [ ] The Weekend Aerial Intensive renders as three tiles (each chipped `Day 1/3`, `Day 2/3`, `Day 3/3`).
- [ ] Location chips filter rows.
- [ ] Detail page for a class shows the capacity breakdown.
- [ ] Commit: `feat(fe-portal): schedule capacity, workshop dropdown, +PT picker, per-day workshop tiles, location chips`

---

## Task 13 — Check-in page: location pill

**Files:**
- Modify: `fe-portal/src/app/admin/check-in/page.tsx`

### Step 1: Mount pill + filter

```tsx
import { useState } from "react";
import { CheckinLocationPill } from "@/components/locations/checkin-location-pill";

const [locationId, setLocationId] = useState<string | null>(null);
// in JSX near the page title:
<CheckinLocationPill value={locationId} onChange={setLocationId} />
// if (!locationId) render an interstitial: "Pick a location to start check-in."
// when locationId is set, scope the check-in queue to that location.
```

### Step 2: Smoke + commit

- [ ] Visit `/admin/check-in`. Pill appears; switching prompts confirm; selection persists across reload.
- [ ] Commit: `feat(fe-portal): check-in single-location pill`

---

## Task 14 — Delete availability page; cleanup

**Files:**
- Delete: `fe-portal/src/app/admin/availability/page.tsx`
- Search-and-remove: any imports of deleted seed/types.

### Step 1: Delete the file.

### Step 2: Search for `availability` references across `fe-portal/src` and `fe-portal/src/data/index.ts`; remove dangling imports/exports.

### Step 3: Smoke + commit

- [ ] `pnpm exec tsc --noEmit` passes cleanly across the whole project.
- [ ] `/admin/availability` returns 404.
- [ ] Commit: `feat(fe-portal): remove availability page and dangling refs`

---

## Task 15 — Final integration smoke + housekeeping

- [ ] Run `pnpm exec tsc --noEmit` from `fe-portal/` — passes.
- [ ] Run `pnpm build` from `fe-portal/` — passes.
- [ ] Walk through Acceptance criteria 1–27 from the spec, ticking each on the running app.
- [ ] Commit: `chore(fe-portal): final lint/typecheck pass for revisions batch`

---

## Self-review checklist

- [ ] Class types: difficulty (incl. `general`), description, parent — covered by Task 4.
- [ ] Location filter chips on Schedule + Workshops; pill on Check-in; fresh-install gate — Tasks 3, 8, 12, 13.
- [ ] Client package expiry + set-balance — Task 10.
- [ ] Trial Pass quota-based with description + one-per-client visual — Tasks 2 (seed), 6 (admin section). fe-client work is a separate plan.
- [ ] Promotions multi per package, quick %s, manual price, date range, multi via `+ Add` — Tasks 5, 6, 7.
- [ ] Workshops: multi-day, three-stage editor, schedule per-day tiles, Workshop dropdown — Tasks 8, 9, 12.
- [ ] PT Requests inbox with two entry points (drawer + scheduler picker) — Tasks 11, 12.
- [ ] Capacity buckets on classes, workshop days, PT sessions; breakdown on detail — Tasks 5, 9, 11, 12.
- [ ] Availability removed entirely — Tasks 8 (nav), 14 (page).
