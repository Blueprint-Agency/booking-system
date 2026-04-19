# Admin Portal Phase 3 — Clients & Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 1 `<ComingSoon />` placeholders for **Clients**, **Catalog (Packages / Workshops / Class templates)**, **Instructors**, and **Locations** with fully interactive CRUD screens backed by the existing in-memory mock store.

**Architecture:** Same pattern as Phase 2 — all mutations go through new methods on `mock-state.ts` (adding `clients`, `products`, `clientPackages`, `instructors`, `locations`, `sessionTemplates` to the state shape). List pages are thin; forms live in their own modals. Client profile uses the existing `AuditTimeline` for credit-adjustment history. No new UI primitives needed.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, existing Phase 1 UI primitives (`Button`, `Badge`, `Card`, `Modal`, `Table`, `Tabs`, `Input`, `Label`, `Select`, `Textarea`, `EmptyState`, `PageHeader`, `StatCard`, `AuditTimeline`), `lucide-react`.

**Spec reference:** `docs/md/prd-admin.md` §§ 6.7, 6.8, 6.9, 6.10, 7.1.

**Phase 2 commit range this builds on:** up to `2b45ea5`.

---

## Working directory

All paths are relative to `C:\Users\chris\Desktop\blueprint\teeko\booking-system`. Run all `npm`/`npx` commands from inside `fe-admin/`.

---

## Confirmed Phase 1 primitive APIs (use these exactly)

- `PageHeader` — `{ title, description?, actions? }`
- `StatCard` — `{ icon?, label, value, hint? }`
- `Badge` — `{ tone?: "neutral"|"accent"|"sage"|"warning"|"error"|"cyan", className?, children }`
- `Button` — supports `variant="default"|"ghost"|"danger"|"outline"` and `size="sm"|"md"`; **no `icon` size**
- `Card` — no default padding; use `className="px-5 py-4"` inside content
- `Modal` — `{ open, onClose, title, children }`
- `AuditTimeline` — `{ rows: { when: string; label: string; detail?: string }[] }` (grep to confirm; fall back to what exists)

Whenever the plan's sample code conflicts with these APIs, adapt to the existing API. Do not invent new props.

---

## File Structure

**New files:**

```
fe-admin/src/
├── components/
│   ├── clients/
│   │   ├── client-row.tsx                  # one row in list
│   │   ├── client-filters.tsx              # search + filter pills
│   │   ├── adjust-credits-modal.tsx        # +/- delta with reason
│   │   └── client-timeline.tsx             # bookings + credit adjustments timeline
│   ├── catalog/
│   │   ├── product-form.tsx                # shared form for package/membership/private-pack/workshop product rows
│   │   ├── product-row.tsx
│   │   ├── template-form.tsx               # SessionTemplate form (class types)
│   │   └── template-row.tsx
│   ├── instructors/
│   │   ├── instructor-form.tsx
│   │   └── instructor-row.tsx
│   └── locations/
│       ├── location-form.tsx
│       └── location-row.tsx
└── app/(admin)/
    ├── clients/[id]/page.tsx
    └── instructors/[id]/page.tsx
```

**Modified files:**

```
fe-admin/src/lib/mock-state.ts                         # add clients/products/instructors/locations/templates to state + mutators
fe-admin/src/app/(admin)/clients/page.tsx              # replace ComingSoon
fe-admin/src/app/(admin)/catalog/packages/page.tsx     # replace ComingSoon
fe-admin/src/app/(admin)/catalog/workshops/page.tsx    # replace ComingSoon
fe-admin/src/app/(admin)/catalog/classes/page.tsx      # replace ComingSoon (class templates)
fe-admin/src/app/(admin)/instructors/page.tsx          # replace ComingSoon
fe-admin/src/app/(admin)/locations/page.tsx            # replace ComingSoon
```

---

## Verification Strategy

- `npx tsc --noEmit` after every task touching `.ts`/`.tsx`.
- `npm run build` once at the end of Task 16.
- Dev smoke test at the end — curl the 8 new/modified routes and confirm 200s.

---

## Task 1 — Extend mock state with catalog entities + mutators

**Files:**
- Modify: `fe-admin/src/lib/mock-state.ts`
- Modify: `fe-admin/src/data/` (none — re-use existing seeded JSON)

- [ ] **Step 1: Add new state slices + imports**

Open `fe-admin/src/lib/mock-state.ts`.

Add these imports to the top-of-file import block (alongside the existing seed imports):

```ts
import clientsData from "@/data/clients.json";
import productsData from "@/data/products.json";
import clientPackagesData from "@/data/client-packages.json";
import membershipsData from "@/data/memberships.json";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";
import sessionTemplatesData from "@/data/session-templates.json";
```

Add to the type import block:

```ts
import type {
  Client,
  ClientPackage,
  Instructor,
  Location,
  Membership,
  Product,
} from "@/types";
```

(Keep everything already there. `SessionTemplate` already imported in Phase 2.)

- [ ] **Step 2: Extend `AdminState`**

Update the `AdminState` type:

```ts
export type AdminState = {
  adminId: string | null;
  sessions: Session[];
  bookings: Booking[];
  privateRequests: PrivateRequest[];
  invoices: Invoice[];
  creditAdjustments: CreditAdjustment[];
  refunds: Refund[];
  waivers: WaiverSignature[];
  emailTemplates: EmailTemplate[];
  sessionCancellations: SessionCancellation[];
  // Phase 3:
  clients: Client[];
  products: Product[];
  clientPackages: ClientPackage[];
  memberships: Membership[];
  instructors: Instructor[];
  locations: Location[];
  sessionTemplates: SessionTemplate[];
};
```

Update `freshState()` to seed these:

```ts
function freshState(): AdminState {
  return {
    adminId: null,
    sessions: sessionsData as Session[],
    bookings: bookingsData as Booking[],
    privateRequests: privateRequestsData as PrivateRequest[],
    invoices: invoicesData as Invoice[],
    creditAdjustments: creditAdjustmentsData as CreditAdjustment[],
    refunds: refundsData as Refund[],
    waivers: waiversData as WaiverSignature[],
    emailTemplates: emailTemplatesData as EmailTemplate[],
    sessionCancellations: sessionCancellationsData as SessionCancellation[],
    clients: clientsData as Client[],
    products: productsData as Product[],
    clientPackages: clientPackagesData as ClientPackage[],
    memberships: membershipsData as Membership[],
    instructors: instructorsData as Instructor[],
    locations: locationsData as Location[],
    sessionTemplates: sessionTemplatesData as SessionTemplate[],
  };
}
```

- [ ] **Step 3: Append Phase 3 mutators**

Append to the end of `fe-admin/src/lib/mock-state.ts` (after the Phase 2 mutators):

```ts
// =====================================================
// --- Phase 3: Clients & Catalog mutators ------------
// =====================================================

// ---- Clients ----

export function upsertClient(input: Partial<Client> & { id?: string }): Client {
  const state = getState();
  const now = nowIso();
  if (input.id) {
    const existing = state.clients.find((c) => c.id === input.id);
    if (!existing) throw new Error(`Client ${input.id} not found`);
    const merged: Client = { ...existing, ...input } as Client;
    setState({ ...state, clients: state.clients.map((c) => (c.id === input.id ? merged : c)) });
    return merged;
  }
  const created: Client = {
    id: nextId("cli"),
    tenantId: input.tenantId ?? state.clients[0]?.tenantId ?? "",
    firstName: input.firstName ?? "",
    lastName: input.lastName ?? "",
    email: input.email ?? "",
    phone: input.phone ?? "",
    registeredAt: now,
    activityStatus: "active",
    noShowCount: 0,
    totalSessions: 0,
    tags: input.tags ?? [],
    waiverSigned: false,
    waiverSignedAt: null,
    waiverVersion: null,
    referralCode: `REF-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    referredBy: input.referredBy ?? null,
    notes: input.notes,
  };
  setState({ ...state, clients: [...state.clients, created] });
  return created;
}

export function adjustClientCredits(input: {
  clientId: string;
  packageId: string | null;
  delta: number;
  reason: string;
}): CreditAdjustment {
  const state = getState();
  const adj: CreditAdjustment = {
    id: nextId("ca"),
    clientId: input.clientId,
    packageId: input.packageId,
    delta: input.delta,
    reason: input.reason,
    adminId: state.adminId ?? "system",
    createdAt: nowIso(),
  };
  const nextPackages = input.packageId
    ? state.clientPackages.map((p) =>
        p.id === input.packageId
          ? {
              ...p,
              creditsRemaining: Math.max(0, p.creditsRemaining + input.delta),
              status:
                p.creditsRemaining + input.delta <= 0 ? ("depleted" as const) : p.status,
            }
          : p,
      )
    : state.clientPackages;
  setState({
    ...state,
    creditAdjustments: [...state.creditAdjustments, adj],
    clientPackages: nextPackages,
  });
  return adj;
}

// ---- Products (packages / workshops / memberships / private packs) ----

export function upsertProduct(input: Partial<Product> & { id?: string }): Product {
  const state = getState();
  if (input.id) {
    const existing = state.products.find((p) => p.id === input.id);
    if (!existing) throw new Error(`Product ${input.id} not found`);
    const merged: Product = { ...existing, ...input } as Product;
    setState({ ...state, products: state.products.map((p) => (p.id === input.id ? merged : p)) });
    return merged;
  }
  const created: Product = {
    id: nextId("prod"),
    tenantId: input.tenantId ?? state.products[0]?.tenantId ?? "",
    name: input.name ?? "Untitled",
    type: input.type ?? "package",
    creditType: input.creditType ?? "class",
    price: input.price ?? 0,
    sessionCount: input.sessionCount ?? null,
    expiryDays: input.expiryDays ?? null,
    sessionsPerMonth: input.sessionsPerMonth ?? null,
    description: input.description ?? "",
    active: input.active ?? true,
  };
  setState({ ...state, products: [...state.products, created] });
  return created;
}

export function toggleProductActive(productId: string): void {
  const state = getState();
  setState({
    ...state,
    products: state.products.map((p) =>
      p.id === productId ? { ...p, active: !p.active } : p,
    ),
  });
}

// ---- Instructors ----

export function upsertInstructor(input: Partial<Instructor> & { id?: string }): Instructor {
  const state = getState();
  if (input.id) {
    const existing = state.instructors.find((i) => i.id === input.id);
    if (!existing) throw new Error(`Instructor ${input.id} not found`);
    const merged: Instructor = { ...existing, ...input } as Instructor;
    setState({ ...state, instructors: state.instructors.map((i) => (i.id === input.id ? merged : i)) });
    return merged;
  }
  const created: Instructor = {
    id: nextId("inst"),
    tenantId: input.tenantId ?? state.instructors[0]?.tenantId ?? "",
    name: input.name ?? "New Instructor",
    bio: input.bio ?? "",
    photo: input.photo ?? "",
    specialties: input.specialties ?? [],
    availability: input.availability ?? [],
  };
  setState({ ...state, instructors: [...state.instructors, created] });
  return created;
}

// ---- Locations ----

export function upsertLocation(input: Partial<Location> & { id?: string }): Location {
  const state = getState();
  if (input.id) {
    const existing = state.locations.find((l) => l.id === input.id);
    if (!existing) throw new Error(`Location ${input.id} not found`);
    const merged: Location = { ...existing, ...input } as Location;
    setState({ ...state, locations: state.locations.map((l) => (l.id === input.id ? merged : l)) });
    return merged;
  }
  const created: Location = {
    id: nextId("loc"),
    tenantId: input.tenantId ?? state.locations[0]?.tenantId ?? "",
    name: input.name ?? "New Location",
    shortName: input.shortName ?? "New",
    address: input.address ?? "",
    area: input.area ?? "",
    rooms: input.rooms,
    amenities: input.amenities ?? [],
    mapUrl: input.mapUrl,
  };
  setState({ ...state, locations: [...state.locations, created] });
  return created;
}

// ---- Class templates ----

export function upsertSessionTemplate(
  input: Partial<SessionTemplate> & { id?: string },
): SessionTemplate {
  const state = getState();
  if (input.id) {
    const existing = state.sessionTemplates.find((t) => t.id === input.id);
    if (!existing) throw new Error(`Template ${input.id} not found`);
    const merged: SessionTemplate = { ...existing, ...input } as SessionTemplate;
    setState({
      ...state,
      sessionTemplates: state.sessionTemplates.map((t) => (t.id === input.id ? merged : t)),
    });
    return merged;
  }
  const created: SessionTemplate = {
    id: nextId("tmpl"),
    tenantId: input.tenantId ?? state.sessionTemplates[0]?.tenantId ?? "",
    locationId: input.locationId ?? "",
    name: input.name ?? "New Template",
    category: input.category ?? "Vinyasa",
    level: input.level ?? "all",
    instructorId: input.instructorId ?? "",
    dayOfWeek: input.dayOfWeek ?? 1,
    time: input.time ?? "07:00",
    duration: input.duration ?? 60,
    capacity: input.capacity ?? 15,
    creditCost: input.creditCost ?? 1,
    active: input.active ?? true,
  };
  setState({ ...state, sessionTemplates: [...state.sessionTemplates, created] });
  return created;
}

export function toggleTemplateActive(id: string): void {
  const state = getState();
  setState({
    ...state,
    sessionTemplates: state.sessionTemplates.map((t) =>
      t.id === id ? { ...t, active: !t.active } : t,
    ),
  });
}
```

- [ ] **Step 4: Type-check**

```bash
cd fe-admin && npx tsc --noEmit
```
Expected: no errors. If a Phase 2 page imported data directly from `@/data/*.json` (e.g. `clientsData`), it still works because the JSON remains the seed. Pages that should react to edits must switch to reading from `state.clients` / `state.products` / etc. — that work happens in the per-page tasks below.

- [ ] **Step 5: Commit**

```bash
git add fe-admin/src/lib/mock-state.ts
git commit -m "feat(fe-admin): extend mock state with clients/catalog/instructors/locations mutators"
```

---

## Task 2 — Client list row + filters

**Files:**
- Create: `fe-admin/src/components/clients/client-row.tsx`
- Create: `fe-admin/src/components/clients/client-filters.tsx`

- [ ] **Step 1: ClientRow**

Write `fe-admin/src/components/clients/client-row.tsx`:

```tsx
import Link from "next/link";
import type { Client, ClientPackage } from "@/types";
import { Badge } from "@/components/ui/badge";

export function ClientRow({
  client,
  packages,
}: {
  client: Client;
  packages: ClientPackage[];
}) {
  const activePackages = packages.filter(
    (p) => p.clientId === client.id && p.status === "active",
  );
  const totalCredits = activePackages.reduce((acc, p) => acc + p.creditsRemaining, 0);
  return (
    <tr className="border-t border-ink/5 hover:bg-paper/40">
      <td className="px-4 py-3">
        <Link
          href={`/clients/${client.id}`}
          className="font-medium text-ink hover:text-accent"
        >
          {client.firstName} {client.lastName}
        </Link>
        <div className="text-xs text-ink/50">{client.email}</div>
      </td>
      <td className="px-4 py-3 text-sm text-ink/70">{client.phone}</td>
      <td className="px-4 py-3">
        <Badge tone={client.activityStatus === "active" ? "sage" : "neutral"}>
          {client.activityStatus}
        </Badge>
      </td>
      <td className="px-4 py-3 text-sm font-mono text-ink/70">{totalCredits}</td>
      <td className="px-4 py-3">
        {client.waiverSigned ? (
          <Badge tone="sage">signed v{client.waiverVersion ?? "–"}</Badge>
        ) : (
          <Badge tone="warning">unsigned</Badge>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-ink/60">{client.noShowCount}</td>
    </tr>
  );
}
```

- [ ] **Step 2: ClientFilters**

Write `fe-admin/src/components/clients/client-filters.tsx`:

```tsx
"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type ClientFilterState = {
  q: string;
  waiver: "all" | "signed" | "unsigned";
  activity: "all" | "active" | "inactive";
};

export function ClientFilters({
  value,
  onChange,
}: {
  value: ClientFilterState;
  onChange: (v: ClientFilterState) => void;
}) {
  const setQ = (q: string) => onChange({ ...value, q });
  const setWaiver = (waiver: ClientFilterState["waiver"]) => onChange({ ...value, waiver });
  const setActivity = (activity: ClientFilterState["activity"]) => onChange({ ...value, activity });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        placeholder="Search name, email, phone"
        value={value.q}
        onChange={(e) => setQ(e.target.value)}
        className="min-w-[240px] flex-1"
      />
      <div className="inline-flex rounded-lg border border-ink/10 bg-white p-0.5 text-sm">
        {(["all", "active", "inactive"] as const).map((a) => (
          <button
            key={a}
            onClick={() => setActivity(a)}
            className={
              "rounded-md px-3 py-1 capitalize " +
              (value.activity === a ? "bg-accent text-white" : "text-ink/70 hover:text-ink")
            }
          >
            {a}
          </button>
        ))}
      </div>
      <div className="inline-flex rounded-lg border border-ink/10 bg-white p-0.5 text-sm">
        {(["all", "signed", "unsigned"] as const).map((w) => (
          <button
            key={w}
            onClick={() => setWaiver(w)}
            className={
              "rounded-md px-3 py-1 capitalize " +
              (value.waiver === w ? "bg-accent text-white" : "text-ink/70 hover:text-ink")
            }
          >
            Waiver: {w}
          </button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange({ q: "", waiver: "all", activity: "all" })}
      >
        Reset
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Type-check & commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/components/clients/
git commit -m "feat(fe-admin): add client row + filters components"
```

---

## Task 3 — Clients list page

**Files:**
- Modify: `fe-admin/src/app/(admin)/clients/page.tsx`

- [ ] **Step 1: Overwrite the page**

```tsx
"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { ClientRow } from "@/components/clients/client-row";
import { ClientFilters, type ClientFilterState } from "@/components/clients/client-filters";
import { useAdminState } from "@/lib/mock-state";

export default function ClientsPage() {
  const state = useAdminState();
  const [filters, setFilters] = useState<ClientFilterState>({
    q: "",
    waiver: "all",
    activity: "all",
  });

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return state.clients.filter((c) => {
      if (filters.activity !== "all" && c.activityStatus !== filters.activity) return false;
      if (filters.waiver === "signed" && !c.waiverSigned) return false;
      if (filters.waiver === "unsigned" && c.waiverSigned) return false;
      if (!q) return true;
      const hay = `${c.firstName} ${c.lastName} ${c.email} ${c.phone}`.toLowerCase();
      return hay.includes(q);
    });
  }, [state.clients, filters]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description={`${state.clients.length} total · ${filtered.length} shown`}
      />
      <ClientFilters value={filters} onChange={setFilters} />
      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-paper/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Phone</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Credits</th>
              <th className="px-4 py-2">Waiver</th>
              <th className="px-4 py-2">No-shows</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <ClientRow key={c.id} client={c} packages={state.clientPackages} />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-ink/50">No clients match the filters.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/app/\(admin\)/clients/page.tsx
git commit -m "feat(fe-admin): wire clients list page with search + filters"
```

---

## Task 4 — Adjust credits modal

**Files:**
- Create: `fe-admin/src/components/clients/adjust-credits-modal.tsx`

- [ ] **Step 1: Create modal**

```tsx
"use client";

import { useState } from "react";
import type { Client, ClientPackage, Product } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { adjustClientCredits } from "@/lib/mock-state";

export function AdjustCreditsModal({
  client,
  clientPackages,
  products,
  open,
  onClose,
}: {
  client: Client;
  clientPackages: ClientPackage[];
  products: Product[];
  open: boolean;
  onClose: () => void;
}) {
  const activePackages = clientPackages.filter(
    (p) => p.clientId === client.id && p.status === "active",
  );
  const [packageId, setPackageId] = useState<string>(activePackages[0]?.id ?? "");
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");

  const submit = () => {
    if (!reason.trim() || delta === 0) return;
    adjustClientCredits({
      clientId: client.id,
      packageId: packageId || null,
      delta,
      reason: reason.trim(),
    });
    setDelta(0);
    setReason("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Adjust credits">
      <div className="space-y-3">
        <div>
          <Label htmlFor="ac-pkg">Package (optional)</Label>
          <Select id="ac-pkg" value={packageId} onChange={(e) => setPackageId(e.target.value)}>
            <option value="">— No specific package —</option>
            {activePackages.map((p) => {
              const prod = products.find((x) => x.id === p.productId);
              return (
                <option key={p.id} value={p.id}>
                  {prod?.name ?? p.productId} · {p.creditsRemaining}/{p.creditsTotal} left
                </option>
              );
            })}
          </Select>
        </div>
        <div>
          <Label htmlFor="ac-delta">Delta (positive = add, negative = deduct)</Label>
          <Input
            id="ac-delta"
            type="number"
            value={delta}
            onChange={(e) => setDelta(Number(e.target.value))}
          />
        </div>
        <div>
          <Label htmlFor="ac-reason">Reason</Label>
          <Textarea
            id="ac-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Manual refund, goodwill credit, correction, etc."
          />
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!reason.trim() || delta === 0}>
          Apply adjustment
        </Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/components/clients/adjust-credits-modal.tsx
git commit -m "feat(fe-admin): add adjust-credits modal with audit-logged delta"
```

---

## Task 5 — Client timeline component

**Files:**
- Create: `fe-admin/src/components/clients/client-timeline.tsx`

- [ ] **Step 1: Create timeline**

```tsx
import type {
  Booking,
  CreditAdjustment,
  Session,
} from "@/types";

type Row = { when: string; label: string; detail?: string };

export function ClientTimeline({
  clientId,
  bookings,
  sessions,
  creditAdjustments,
}: {
  clientId: string;
  bookings: Booking[];
  sessions: Session[];
  creditAdjustments: CreditAdjustment[];
}) {
  const rows: Row[] = [];
  for (const b of bookings.filter((x) => x.clientId === clientId)) {
    const s = sessions.find((x) => x.id === b.sessionId);
    rows.push({
      when: b.createdAt,
      label: `Booking · ${s?.name ?? "Unknown"} (${b.status})`,
      detail: s ? `${s.date} ${s.time}` : undefined,
    });
  }
  for (const ca of creditAdjustments.filter((x) => x.clientId === clientId)) {
    rows.push({
      when: ca.createdAt,
      label: `Credit ${ca.delta > 0 ? "+" : ""}${ca.delta}`,
      detail: ca.reason,
    });
  }
  rows.sort((a, b) => (a.when < b.when ? 1 : -1));

  if (rows.length === 0) {
    return <div className="text-sm text-ink/50">No activity yet.</div>;
  }
  return (
    <ul className="space-y-3">
      {rows.slice(0, 50).map((r, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
          <div>
            <div className="text-sm font-medium text-ink">{r.label}</div>
            {r.detail && <div className="text-xs text-ink/60">{r.detail}</div>}
            <div className="font-mono text-[11px] text-ink/40">{r.when}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/components/clients/client-timeline.tsx
git commit -m "feat(fe-admin): add client timeline (bookings + credit adjustments)"
```

---

## Task 6 — Client profile page

**Files:**
- Create: `fe-admin/src/app/(admin)/clients/[id]/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
"use client";

import { use, useState } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { ClientTimeline } from "@/components/clients/client-timeline";
import { AdjustCreditsModal } from "@/components/clients/adjust-credits-modal";
import { useAdminState } from "@/lib/mock-state";

export default function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const state = useAdminState();
  const client = state.clients.find((c) => c.id === id);
  const [adjustOpen, setAdjustOpen] = useState(false);

  if (!client) return notFound();

  const bookings = state.bookings.filter((b) => b.clientId === id);
  const upcoming = bookings.filter((b) => {
    const s = state.sessions.find((x) => x.id === b.sessionId);
    return s ? s.date >= "2026-04-20" && b.status !== "cancelled" : false;
  });
  const activePackages = state.clientPackages.filter(
    (p) => p.clientId === id && p.status === "active",
  );
  const totalCredits = activePackages.reduce((acc, p) => acc + p.creditsRemaining, 0);
  const membership = state.memberships.find(
    (m) => m.clientId === id && m.status === "active",
  );

  return (
    <div className="space-y-6">
      <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back to clients
      </Link>

      <PageHeader
        title={`${client.firstName} ${client.lastName}`}
        description={`${client.email} · ${client.phone}`}
        actions={<Button onClick={() => setAdjustOpen(true)}>Adjust credits</Button>}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Credits" value={String(totalCredits)} hint={`${activePackages.length} active pkg`} />
        <StatCard label="Upcoming" value={String(upcoming.length)} />
        <StatCard label="Total sessions" value={String(client.totalSessions)} />
        <StatCard label="No-shows" value={String(client.noShowCount)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="px-5 py-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/70">
            Activity timeline
          </h3>
          <ClientTimeline
            clientId={id}
            bookings={state.bookings}
            sessions={state.sessions}
            creditAdjustments={state.creditAdjustments}
          />
        </Card>

        <div className="space-y-4">
          <Card className="px-5 py-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
              Membership
            </h3>
            {membership ? (
              <div className="text-sm">
                <Badge tone="sage">{membership.status}</Badge>
                <div className="mt-1 text-xs text-ink/60">
                  {membership.startsAt} → {membership.endsAt}
                </div>
              </div>
            ) : (
              <div className="text-sm text-ink/50">None</div>
            )}
          </Card>

          <Card className="px-5 py-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
              Waiver
            </h3>
            {client.waiverSigned ? (
              <div>
                <Badge tone="sage">signed v{client.waiverVersion ?? "–"}</Badge>
                <div className="mt-1 text-xs text-ink/60">{client.waiverSignedAt}</div>
              </div>
            ) : (
              <Badge tone="warning">unsigned</Badge>
            )}
          </Card>

          <Card className="px-5 py-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
              Referral
            </h3>
            <div className="font-mono text-sm text-ink">{client.referralCode}</div>
            {client.referredBy && (
              <div className="mt-1 text-xs text-ink/60">Referred by {client.referredBy}</div>
            )}
          </Card>

          {client.notes && (
            <Card className="px-5 py-4">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
                Notes
              </h3>
              <p className="whitespace-pre-wrap text-sm text-ink/80">{client.notes}</p>
            </Card>
          )}
        </div>
      </div>

      <AdjustCreditsModal
        client={client}
        clientPackages={state.clientPackages}
        products={state.products}
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/app/\(admin\)/clients/\[id\]/page.tsx
git commit -m "feat(fe-admin): add client profile page with timeline + packages"
```

---

## Task 7 — Product form + row

**Files:**
- Create: `fe-admin/src/components/catalog/product-form.tsx`
- Create: `fe-admin/src/components/catalog/product-row.tsx`

- [ ] **Step 1: Product form (covers all product types)**

```tsx
"use client";

import { useState } from "react";
import type { Product } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { upsertProduct } from "@/lib/mock-state";

export function ProductForm({
  initial,
  open,
  onClose,
  defaultType = "package",
}: {
  initial?: Product;
  open: boolean;
  onClose: () => void;
  defaultType?: Product["type"];
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<Product["type"]>(initial?.type ?? defaultType);
  const [creditType, setCreditType] = useState<Product["creditType"]>(
    initial?.creditType ?? "class",
  );
  const [price, setPrice] = useState(initial?.price ?? 0);
  const [sessionCount, setSessionCount] = useState<number | "">(
    initial?.sessionCount ?? "",
  );
  const [expiryDays, setExpiryDays] = useState<number | "">(initial?.expiryDays ?? "");
  const [sessionsPerMonth, setSessionsPerMonth] = useState<number | "">(
    initial?.sessionsPerMonth ?? "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [active, setActive] = useState(initial?.active ?? true);

  const submit = () => {
    upsertProduct({
      id: initial?.id,
      name,
      type,
      creditType,
      price,
      sessionCount: sessionCount === "" ? null : Number(sessionCount),
      expiryDays: expiryDays === "" ? null : Number(expiryDays),
      sessionsPerMonth: sessionsPerMonth === "" ? null : Number(sessionsPerMonth),
      description,
      active,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit product" : "New product"}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="pf-name">Name</Label>
          <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pf-type">Type</Label>
          <Select id="pf-type" value={type} onChange={(e) => setType(e.target.value as Product["type"])}>
            <option value="package">Package</option>
            <option value="membership">Membership</option>
            <option value="workshop">Workshop</option>
            <option value="private-pack">Private pack</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="pf-credit">Credit type</Label>
          <Select
            id="pf-credit"
            value={creditType}
            onChange={(e) => setCreditType(e.target.value as Product["creditType"])}
          >
            <option value="class">Class</option>
            <option value="pt">Private</option>
            <option value="none">None</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="pf-price">Price (SGD)</Label>
          <Input id="pf-price" type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="pf-count">Session count</Label>
          <Input
            id="pf-count"
            type="number"
            value={sessionCount === "" ? "" : sessionCount}
            onChange={(e) => setSessionCount(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
        <div>
          <Label htmlFor="pf-exp">Expiry (days)</Label>
          <Input
            id="pf-exp"
            type="number"
            value={expiryDays === "" ? "" : expiryDays}
            onChange={(e) => setExpiryDays(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
        <div>
          <Label htmlFor="pf-spm">Sessions / month (unlimited only)</Label>
          <Input
            id="pf-spm"
            type="number"
            value={sessionsPerMonth === "" ? "" : sessionsPerMonth}
            onChange={(e) => setSessionsPerMonth(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
        <div className="col-span-2">
          <Label htmlFor="pf-desc">Description</Label>
          <Textarea
            id="pf-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <input
            id="pf-active"
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <Label htmlFor="pf-active">Active (shown in client portal)</Label>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!name.trim()}>Save</Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Product row**

```tsx
"use client";

import type { Product } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toggleProductActive } from "@/lib/mock-state";

export function ProductRow({
  product,
  onEdit,
}: {
  product: Product;
  onEdit: (p: Product) => void;
}) {
  return (
    <tr className="border-t border-ink/5">
      <td className="px-4 py-3">
        <div className="font-medium text-ink">{product.name}</div>
        {product.description && (
          <div className="text-xs text-ink/50 line-clamp-1">{product.description}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge tone="neutral">{product.type}</Badge>
      </td>
      <td className="px-4 py-3 font-mono text-ink/70">S${product.price}</td>
      <td className="px-4 py-3 font-mono text-ink/70">
        {product.sessionCount ?? product.sessionsPerMonth ?? "—"}
      </td>
      <td className="px-4 py-3">
        {product.active ? (
          <Badge tone="sage">active</Badge>
        ) : (
          <Badge tone="neutral">archived</Badge>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <Button variant="ghost" size="sm" onClick={() => toggleProductActive(product.id)}>
          {product.active ? "Archive" : "Restore"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onEdit(product)}>
          Edit
        </Button>
      </td>
    </tr>
  );
}
```

- [ ] **Step 3: Type-check & commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/components/catalog/product-form.tsx fe-admin/src/components/catalog/product-row.tsx
git commit -m "feat(fe-admin): add product form + row for catalog CRUD"
```

---

## Task 8 — Packages page

**Files:**
- Modify: `fe-admin/src/app/(admin)/catalog/packages/page.tsx`

- [ ] **Step 1: Wire the page**

```tsx
"use client";

import { useState } from "react";
import type { Product } from "@/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ProductRow } from "@/components/catalog/product-row";
import { ProductForm } from "@/components/catalog/product-form";
import { useAdminState } from "@/lib/mock-state";

const PACKAGE_TYPES: Product["type"][] = ["package", "membership", "private-pack"];

export default function PackagesPage() {
  const state = useAdminState();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);

  const products = state.products.filter((p) => PACKAGE_TYPES.includes(p.type));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Packages & memberships"
        description="Credit bundles, unlimited memberships, and private packs."
        actions={<Button onClick={() => setCreating(true)}>New product</Button>}
      />

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-paper/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Price</th>
              <th className="px-4 py-2">Sessions</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <ProductRow key={p.id} product={p} onEdit={setEditing} />
            ))}
          </tbody>
        </table>
        {products.length === 0 && (
          <div className="p-8 text-center text-sm text-ink/50">No packages yet.</div>
        )}
      </div>

      {creating && (
        <ProductForm open={creating} onClose={() => setCreating(false)} defaultType="package" />
      )}
      {editing && (
        <ProductForm initial={editing} open={!!editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/app/\(admin\)/catalog/packages/page.tsx
git commit -m "feat(fe-admin): wire packages catalog page"
```

---

## Task 9 — Workshops catalog page

**Files:**
- Modify: `fe-admin/src/app/(admin)/catalog/workshops/page.tsx`

- [ ] **Step 1: Wire the page**

```tsx
"use client";

import { useState } from "react";
import type { Product } from "@/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ProductRow } from "@/components/catalog/product-row";
import { ProductForm } from "@/components/catalog/product-form";
import { useAdminState } from "@/lib/mock-state";

export default function WorkshopsCatalogPage() {
  const state = useAdminState();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);

  const products = state.products.filter((p) => p.type === "workshop");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workshops catalog"
        description="Paid one-off workshop products. For scheduling, use Schedule → Add workshop."
        actions={<Button onClick={() => setCreating(true)}>New workshop product</Button>}
      />

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-paper/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Price</th>
              <th className="px-4 py-2">Sessions</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <ProductRow key={p.id} product={p} onEdit={setEditing} />
            ))}
          </tbody>
        </table>
        {products.length === 0 && (
          <div className="p-8 text-center text-sm text-ink/50">No workshop products yet.</div>
        )}
      </div>

      {creating && (
        <ProductForm open={creating} onClose={() => setCreating(false)} defaultType="workshop" />
      )}
      {editing && <ProductForm initial={editing} open={!!editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/app/\(admin\)/catalog/workshops/page.tsx
git commit -m "feat(fe-admin): wire workshops catalog page"
```

---

## Task 10 — Class template form + row

**Files:**
- Create: `fe-admin/src/components/catalog/template-form.tsx`
- Create: `fe-admin/src/components/catalog/template-row.tsx`

- [ ] **Step 1: Template form**

```tsx
"use client";

import { useState } from "react";
import type { Instructor, Location, SessionTemplate } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { upsertSessionTemplate } from "@/lib/mock-state";

const DAYS = [
  { v: 1, l: "Mon" },
  { v: 2, l: "Tue" },
  { v: 3, l: "Wed" },
  { v: 4, l: "Thu" },
  { v: 5, l: "Fri" },
  { v: 6, l: "Sat" },
  { v: 0, l: "Sun" },
] as const;

export function TemplateForm({
  initial,
  instructors,
  locations,
  open,
  onClose,
}: {
  initial?: SessionTemplate;
  instructors: Instructor[];
  locations: Location[];
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "Vinyasa");
  const [level, setLevel] = useState<SessionTemplate["level"]>(initial?.level ?? "all");
  const [instructorId, setInstructorId] = useState(initial?.instructorId ?? instructors[0]?.id ?? "");
  const [locationId, setLocationId] = useState(initial?.locationId ?? locations[0]?.id ?? "");
  const [dayOfWeek, setDayOfWeek] = useState<SessionTemplate["dayOfWeek"]>(initial?.dayOfWeek ?? 1);
  const [time, setTime] = useState(initial?.time ?? "07:00");
  const [duration, setDuration] = useState(initial?.duration ?? 60);
  const [capacity, setCapacity] = useState(initial?.capacity ?? 15);
  const [creditCost, setCreditCost] = useState(initial?.creditCost ?? 1);

  const submit = () => {
    upsertSessionTemplate({
      id: initial?.id,
      name,
      category,
      level,
      instructorId,
      locationId,
      dayOfWeek,
      time,
      duration,
      capacity,
      creditCost,
      active: initial?.active ?? true,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit template" : "New class template"}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="tf-name">Name</Label>
          <Input id="tf-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="tf-cat">Category</Label>
          <Input id="tf-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="tf-level">Level</Label>
          <Select
            id="tf-level"
            value={level}
            onChange={(e) => setLevel(e.target.value as SessionTemplate["level"])}
          >
            <option value="all">All</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="tf-inst">Instructor</Label>
          <Select id="tf-inst" value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="tf-loc">Location</Label>
          <Select id="tf-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="tf-day">Day of week</Label>
          <Select
            id="tf-day"
            value={String(dayOfWeek)}
            onChange={(e) => setDayOfWeek(Number(e.target.value) as SessionTemplate["dayOfWeek"])}
          >
            {DAYS.map((d) => (
              <option key={d.v} value={d.v}>{d.l}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="tf-time">Time</Label>
          <Input id="tf-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="tf-dur">Duration (min)</Label>
          <Input id="tf-dur" type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="tf-cap">Capacity</Label>
          <Input id="tf-cap" type="number" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </div>
        <div className="col-span-2">
          <Label htmlFor="tf-cost">Credit cost</Label>
          <Input id="tf-cost" type="number" value={creditCost} onChange={(e) => setCreditCost(Number(e.target.value))} />
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!name.trim()}>Save</Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Template row**

```tsx
"use client";

import type { Instructor, Location, SessionTemplate } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toggleTemplateActive } from "@/lib/mock-state";

const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function TemplateRow({
  template,
  instructors,
  locations,
  onEdit,
}: {
  template: SessionTemplate;
  instructors: Instructor[];
  locations: Location[];
  onEdit: (t: SessionTemplate) => void;
}) {
  const inst = instructors.find((i) => i.id === template.instructorId);
  const loc = locations.find((l) => l.id === template.locationId);
  return (
    <tr className="border-t border-ink/5">
      <td className="px-4 py-3">
        <div className="font-medium text-ink">{template.name}</div>
        <div className="text-xs text-ink/50">{template.category} · {template.level}</div>
      </td>
      <td className="px-4 py-3 text-sm text-ink/70">{inst?.name ?? "—"}</td>
      <td className="px-4 py-3 text-sm text-ink/70">{loc?.shortName ?? "—"}</td>
      <td className="px-4 py-3 font-mono text-sm text-ink/70">
        {DAY_LABEL[template.dayOfWeek]} {template.time} · {template.duration}m
      </td>
      <td className="px-4 py-3 font-mono text-sm text-ink/70">{template.capacity}</td>
      <td className="px-4 py-3">
        {template.active ? <Badge tone="sage">active</Badge> : <Badge tone="neutral">paused</Badge>}
      </td>
      <td className="px-4 py-3 text-right">
        <Button variant="ghost" size="sm" onClick={() => toggleTemplateActive(template.id)}>
          {template.active ? "Pause" : "Resume"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onEdit(template)}>
          Edit
        </Button>
      </td>
    </tr>
  );
}
```

- [ ] **Step 3: Type-check & commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/components/catalog/template-form.tsx fe-admin/src/components/catalog/template-row.tsx
git commit -m "feat(fe-admin): add class-template form + row"
```

---

## Task 11 — Class templates page

**Files:**
- Modify: `fe-admin/src/app/(admin)/catalog/classes/page.tsx`

- [ ] **Step 1: Wire the page**

```tsx
"use client";

import { useState } from "react";
import type { SessionTemplate } from "@/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { TemplateRow } from "@/components/catalog/template-row";
import { TemplateForm } from "@/components/catalog/template-form";
import { useAdminState } from "@/lib/mock-state";

export default function ClassTemplatesPage() {
  const state = useAdminState();
  const [editing, setEditing] = useState<SessionTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Class templates"
        description="Recurring class definitions. Use Schedule → Create class to generate instances."
        actions={<Button onClick={() => setCreating(true)}>New template</Button>}
      />

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-paper/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Instructor</th>
              <th className="px-4 py-2">Location</th>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Capacity</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {state.sessionTemplates.map((t) => (
              <TemplateRow
                key={t.id}
                template={t}
                instructors={state.instructors}
                locations={state.locations}
                onEdit={setEditing}
              />
            ))}
          </tbody>
        </table>
        {state.sessionTemplates.length === 0 && (
          <div className="p-8 text-center text-sm text-ink/50">No templates yet.</div>
        )}
      </div>

      {creating && (
        <TemplateForm
          instructors={state.instructors}
          locations={state.locations}
          open={creating}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <TemplateForm
          initial={editing}
          instructors={state.instructors}
          locations={state.locations}
          open={!!editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/app/\(admin\)/catalog/classes/page.tsx
git commit -m "feat(fe-admin): wire class-templates page"
```

---

## Task 12 — Instructor form + row

**Files:**
- Create: `fe-admin/src/components/instructors/instructor-form.tsx`
- Create: `fe-admin/src/components/instructors/instructor-row.tsx`

- [ ] **Step 1: Instructor form**

```tsx
"use client";

import { useState } from "react";
import type { Instructor } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { upsertInstructor } from "@/lib/mock-state";

export function InstructorForm({
  initial,
  open,
  onClose,
}: {
  initial?: Instructor;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [photo, setPhoto] = useState(initial?.photo ?? "");
  const [specialties, setSpecialties] = useState((initial?.specialties ?? []).join(", "));

  const submit = () => {
    upsertInstructor({
      id: initial?.id,
      name,
      bio,
      photo,
      specialties: specialties
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      availability: initial?.availability,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit instructor" : "New instructor"}>
      <div className="space-y-3">
        <div>
          <Label htmlFor="if-name">Name</Label>
          <Input id="if-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="if-photo">Photo URL</Label>
          <Input id="if-photo" value={photo} onChange={(e) => setPhoto(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="if-bio">Bio</Label>
          <Textarea id="if-bio" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="if-spec">Specialties (comma-separated)</Label>
          <Input
            id="if-spec"
            value={specialties}
            onChange={(e) => setSpecialties(e.target.value)}
            placeholder="Vinyasa, Yin, Prenatal"
          />
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!name.trim()}>Save</Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Instructor row**

```tsx
"use client";

import Link from "next/link";
import type { Instructor, Session } from "@/types";
import { Button } from "@/components/ui/button";

export function InstructorRow({
  instructor,
  sessions,
  onEdit,
}: {
  instructor: Instructor;
  sessions: Session[];
  onEdit: (i: Instructor) => void;
}) {
  const upcoming = sessions.filter(
    (s) => s.instructorId === instructor.id && s.status === "scheduled" && s.date >= "2026-04-20",
  ).length;
  return (
    <tr className="border-t border-ink/5">
      <td className="px-4 py-3">
        <Link
          href={`/instructors/${instructor.id}`}
          className="font-medium text-ink hover:text-accent"
        >
          {instructor.name}
        </Link>
        <div className="text-xs text-ink/50 line-clamp-1">{instructor.bio}</div>
      </td>
      <td className="px-4 py-3 text-sm text-ink/70">{instructor.specialties.join(", ") || "—"}</td>
      <td className="px-4 py-3 font-mono text-sm text-ink/70">{upcoming}</td>
      <td className="px-4 py-3 text-right">
        <Button variant="ghost" size="sm" onClick={() => onEdit(instructor)}>Edit</Button>
      </td>
    </tr>
  );
}
```

- [ ] **Step 3: Type-check & commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/components/instructors/
git commit -m "feat(fe-admin): add instructor form + row"
```

---

## Task 13 — Instructors list page

**Files:**
- Modify: `fe-admin/src/app/(admin)/instructors/page.tsx`

- [ ] **Step 1: Wire the page**

```tsx
"use client";

import { useState } from "react";
import type { Instructor } from "@/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { InstructorRow } from "@/components/instructors/instructor-row";
import { InstructorForm } from "@/components/instructors/instructor-form";
import { useAdminState } from "@/lib/mock-state";

export default function InstructorsPage() {
  const state = useAdminState();
  const [editing, setEditing] = useState<Instructor | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Instructors"
        description={`${state.instructors.length} total`}
        actions={<Button onClick={() => setCreating(true)}>New instructor</Button>}
      />

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-paper/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Specialties</th>
              <th className="px-4 py-2">Upcoming</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {state.instructors.map((i) => (
              <InstructorRow
                key={i.id}
                instructor={i}
                sessions={state.sessions}
                onEdit={setEditing}
              />
            ))}
          </tbody>
        </table>
        {state.instructors.length === 0 && (
          <div className="p-8 text-center text-sm text-ink/50">No instructors yet.</div>
        )}
      </div>

      {creating && <InstructorForm open={creating} onClose={() => setCreating(false)} />}
      {editing && (
        <InstructorForm initial={editing} open={!!editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/app/\(admin\)/instructors/page.tsx
git commit -m "feat(fe-admin): wire instructors list page"
```

---

## Task 14 — Instructor detail page

**Files:**
- Create: `fe-admin/src/app/(admin)/instructors/[id]/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
"use client";

import { use, useState } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InstructorForm } from "@/components/instructors/instructor-form";
import { useAdminState } from "@/lib/mock-state";

export default function InstructorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const state = useAdminState();
  const instructor = state.instructors.find((i) => i.id === id);
  const [editing, setEditing] = useState(false);

  if (!instructor) return notFound();

  const upcoming = state.sessions
    .filter((s) => s.instructorId === id && s.status === "scheduled" && s.date >= "2026-04-20")
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .slice(0, 20);
  const requests = state.privateRequests.filter(
    (r) => r.preferredInstructorId === id && r.status === "pending",
  );

  return (
    <div className="space-y-6">
      <Link href="/instructors" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back to instructors
      </Link>
      <PageHeader
        title={instructor.name}
        description={instructor.specialties.join(" · ") || "No specialties listed"}
        actions={<Button onClick={() => setEditing(true)}>Edit</Button>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="px-5 py-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">Bio</h3>
          <p className="text-sm text-ink/80 whitespace-pre-wrap">{instructor.bio || "—"}</p>
        </Card>

        <Card className="px-5 py-4 lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
            Upcoming classes · {upcoming.length}
          </h3>
          {upcoming.length === 0 ? (
            <div className="text-sm text-ink/50">Nothing scheduled.</div>
          ) : (
            <ul className="divide-y divide-ink/5">
              {upcoming.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/schedule/${s.id}`} className="font-medium text-ink hover:text-accent">
                    {s.name}
                  </Link>
                  <span className="font-mono text-xs text-ink/50">
                    {s.date} · {s.time} · {s.bookedCount}/{s.capacity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="px-5 py-4 lg:col-span-3">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
            Pending private requests · {requests.length}
          </h3>
          {requests.length === 0 ? (
            <div className="text-sm text-ink/50">None routed to this instructor.</div>
          ) : (
            <ul className="divide-y divide-ink/5">
              {requests.map((r) => {
                const client = state.clients.find((c) => c.id === r.clientId);
                return (
                  <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/requests/${r.id}`} className="font-medium text-ink hover:text-accent">
                      {client ? `${client.firstName} ${client.lastName}` : "Unknown"}
                    </Link>
                    <Badge tone="warning">pending</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {editing && <InstructorForm initial={instructor} open={editing} onClose={() => setEditing(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/app/\(admin\)/instructors/\[id\]/page.tsx
git commit -m "feat(fe-admin): add instructor detail page"
```

---

## Task 15 — Location form + row + list page

**Files:**
- Create: `fe-admin/src/components/locations/location-form.tsx`
- Create: `fe-admin/src/components/locations/location-row.tsx`
- Modify: `fe-admin/src/app/(admin)/locations/page.tsx`

- [ ] **Step 1: Location form**

```tsx
"use client";

import { useState } from "react";
import type { Location } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { upsertLocation } from "@/lib/mock-state";

export function LocationForm({
  initial,
  open,
  onClose,
}: {
  initial?: Location;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [shortName, setShortName] = useState(initial?.shortName ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [area, setArea] = useState(initial?.area ?? "");
  const [rooms, setRooms] = useState<number | "">(initial?.rooms ?? "");
  const [amenities, setAmenities] = useState((initial?.amenities ?? []).join(", "));

  const submit = () => {
    upsertLocation({
      id: initial?.id,
      name,
      shortName,
      address,
      area,
      rooms: rooms === "" ? undefined : Number(rooms),
      amenities: amenities
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      mapUrl: initial?.mapUrl,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit location" : "New location"}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="lf-name">Name</Label>
          <Input id="lf-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="lf-short">Short name</Label>
          <Input id="lf-short" value={shortName} onChange={(e) => setShortName(e.target.value)} />
        </div>
        <div className="col-span-2">
          <Label htmlFor="lf-addr">Address</Label>
          <Textarea id="lf-addr" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="lf-area">Area</Label>
          <Input id="lf-area" value={area} onChange={(e) => setArea(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="lf-rooms">Rooms</Label>
          <Input
            id="lf-rooms"
            type="number"
            value={rooms === "" ? "" : rooms}
            onChange={(e) => setRooms(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
        <div className="col-span-2">
          <Label htmlFor="lf-amen">Amenities (comma-separated)</Label>
          <Input id="lf-amen" value={amenities} onChange={(e) => setAmenities(e.target.value)} />
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!name.trim()}>Save</Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Location row**

```tsx
"use client";

import type { Location } from "@/types";
import { Button } from "@/components/ui/button";

export function LocationRow({
  location,
  onEdit,
}: {
  location: Location;
  onEdit: (l: Location) => void;
}) {
  return (
    <tr className="border-t border-ink/5">
      <td className="px-4 py-3">
        <div className="font-medium text-ink">{location.name}</div>
        <div className="text-xs text-ink/50">{location.shortName}</div>
      </td>
      <td className="px-4 py-3 text-sm text-ink/70">{location.address}</td>
      <td className="px-4 py-3 text-sm text-ink/70">{location.area}</td>
      <td className="px-4 py-3 font-mono text-sm text-ink/70">{location.rooms ?? "—"}</td>
      <td className="px-4 py-3 text-sm text-ink/70">{location.amenities?.join(", ") ?? "—"}</td>
      <td className="px-4 py-3 text-right">
        <Button variant="ghost" size="sm" onClick={() => onEdit(location)}>Edit</Button>
      </td>
    </tr>
  );
}
```

- [ ] **Step 3: Locations page**

```tsx
"use client";

import { useState } from "react";
import type { Location } from "@/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { LocationRow } from "@/components/locations/location-row";
import { LocationForm } from "@/components/locations/location-form";
import { useAdminState } from "@/lib/mock-state";

export default function LocationsPage() {
  const state = useAdminState();
  const [editing, setEditing] = useState<Location | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Locations"
        description={`${state.locations.length} studios`}
        actions={<Button onClick={() => setCreating(true)}>New location</Button>}
      />
      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-paper/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Address</th>
              <th className="px-4 py-2">Area</th>
              <th className="px-4 py-2">Rooms</th>
              <th className="px-4 py-2">Amenities</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {state.locations.map((l) => (
              <LocationRow key={l.id} location={l} onEdit={setEditing} />
            ))}
          </tbody>
        </table>
      </div>
      {creating && <LocationForm open={creating} onClose={() => setCreating(false)} />}
      {editing && <LocationForm initial={editing} open={!!editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
```

- [ ] **Step 4: Type-check & commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/components/locations/ fe-admin/src/app/\(admin\)/locations/page.tsx
git commit -m "feat(fe-admin): wire locations CRUD page"
```

---

## Task 16 — Build verification + smoke test

**Files:** (no new files)

- [ ] **Step 1: Build**

```bash
cd fe-admin && npm run build
```
Expected: all routes compile. New dynamic routes present: `/clients/[id]`, `/instructors/[id]`.

- [ ] **Step 2: Dev smoke**

Start the dev server:
```bash
cd fe-admin && npm run dev
```

Curl these to confirm 200 (adjust port if yours differs):
```bash
curl -s -o /dev/null -w "%{http_code} /clients\n"       http://localhost:3000/clients
curl -s -o /dev/null -w "%{http_code} /catalog/packages\n"  http://localhost:3000/catalog/packages
curl -s -o /dev/null -w "%{http_code} /catalog/workshops\n" http://localhost:3000/catalog/workshops
curl -s -o /dev/null -w "%{http_code} /catalog/classes\n"   http://localhost:3000/catalog/classes
curl -s -o /dev/null -w "%{http_code} /instructors\n"       http://localhost:3000/instructors
curl -s -o /dev/null -w "%{http_code} /locations\n"         http://localhost:3000/locations
```

Stop the dev server with Ctrl-C.

- [ ] **Step 3: Commit (if any artefacts were updated during build)**

Typically nothing to commit here beyond build cache. If `git status` is clean, skip. Otherwise:

```bash
git status
```

---

## Phase 3 Acceptance Checklist

- [ ] `/clients` list filters by search / activity / waiver in real time.
- [ ] Clicking a client opens `/clients/[id]` with credit stat card, membership, waiver, referral, timeline.
- [ ] **Adjust credits** writes a `credit-adjustments` row visible on the profile timeline; deducts from the selected package's `creditsRemaining`.
- [ ] `/catalog/packages` CRUD works for package / membership / private-pack. Archive toggle flips the `active` flag.
- [ ] `/catalog/workshops` filters to workshop-type products; create/edit works.
- [ ] `/catalog/classes` CRUD for templates; pause/resume flips the `active` flag.
- [ ] `/instructors` CRUD works; clicking a row opens detail with upcoming classes + pending requests routed to them.
- [ ] `/locations` CRUD works.
- [ ] Reload preserves all mutations (localStorage key `admin-mock-state:v1`).
- [ ] `npm run build` succeeds with no new warnings.

---

## Phase 4 Preview (not in this plan)

Finance & Governance: `/invoices` + `/invoices/[id]` with refund modal; `/reports` (attendance heatmap, revenue, sell-through, no-show); `/notifications` email-template editor with live preview; `/waivers` tracking + version bump; `/referrals` referrer + referee lists; `/settings` (studio profile, policy, admin users CRUD).

---

## Self-Review

**Spec coverage (PRD §§ 6.7 – 6.10, 7.1):**
- §6.7 Clients — ✅ Tasks 2-6 (list, search/filter, profile, adjust-credits with audit, waiver+referral cards).
- §6.8 Catalog — ✅ Tasks 7-11 (packages, workshops, class templates CRUD with active toggle).
- §6.9 Instructors — ✅ Tasks 12-14 (CRUD + upcoming classes + routed requests).
- §6.10 Locations — ✅ Task 15.
- §7.1 Audit — ✅ Task 1 `adjustClientCredits` writes `credit-adjustments`; surfaced on profile timeline (Task 6).
- §7.3 Mock persistence — ✅ all mutations go through existing `setState` → localStorage.

**Placeholder scan:** no "TBD" / "implement later" / bare handler stubs. Every code step has complete source.

**Type consistency:** `upsertClient`, `adjustClientCredits`, `upsertProduct`, `toggleProductActive`, `upsertInstructor`, `upsertLocation`, `upsertSessionTemplate`, `toggleTemplateActive` — defined once in Task 1 and referenced by exact names in subsequent tasks. All shapes match `fe-admin/src/types/index.ts`.
