# fe-portal — Superadmin vs Admin + Workspace Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a two-role identity model (`superadmin` / `admin`) and a single global workspace (location) selector in the topbar that drives every workspace-scoped page. Remove the per-page location filters and the sidebar Locations entry.

**Architecture:** Add a client-side `WorkspaceProvider` that owns `currentStaff`, `role`, `accessibleLocations`, `activeLocationId`, and exposes mutators. The provider wraps `AdminShell`. The topbar gains a `<WorkspaceSwitcher />` (replacing the sidebar Locations link) and a `<DevRoleSwitcher />` (mockup-only affordance for switching role/grants). The sidebar `NAV_ITEMS` get a `scope` field and are filtered by role. Workspace-scoped pages read `activeLocationId` from the context instead of their own localStorage keys. Clients pages render in read-only mode when role = admin. The `LocationGate` becomes role-aware (superadmin → "add first location"; admin with no grants → "no access").

**Tech Stack:** Next.js App Router (client components), TypeScript, Tailwind, shadcn/ui, React `useState` + `useEffect` for localStorage hydration. **No test runner exists in this repo** — verification is `pnpm exec tsc --noEmit` + `pnpm build` + manual smoke. Adapt TDD steps to "implement → typecheck → smoke → commit".

---

## Background and Design Decisions

The fe-portal mockup currently treats every page as if a single admin sees everything. Real Yoga Sadhana has two staff roles and multiple location workspaces:

- **Superadmin** — owns the global catalogue and policy. Creates locations, edits class types, configures packages (Classes + Private Sessions + their promotions), edits global policy, manages staff/notifications/waiver. Also has full access to every workspace.
- **Admin** — operations staff scoped to one or more granted locations. Sees Schedule, Workshops, Check-in, PT Requests, Inbox for their workspace, and a read-only view of Clients.

The active location is shared across all workspace-scoped pages. The user picks it once from the topbar dropdown and every page reflects it. This replaces:

- `LocationFilterChips` on Schedule + Workshops list
- `CheckinLocationPill` on Check-in
- The `LocationGate` "add first location" cold-start (now role-aware)
- The sidebar **Locations** nav entry (moved to topbar dropdown's "Manage locations")

### Scope split

| Surface | Scope | Visible to Admin? |
|---|---|---|
| Locations (CRUD) | Global / superadmin | No (hidden) |
| Class Types | Global / superadmin | No |
| Packages → Classes (incl. Trial) | Global / superadmin | No |
| Packages → Private Sessions | Global / superadmin | No |
| Global Policy | Global / superadmin | No |
| Notifications | Global / superadmin | No |
| Waiver | Global / superadmin | No |
| Staff | Global / superadmin | No |
| Instructors | Global (kept visible to both for now) | Yes |
| Schedule | Workspace | Yes |
| Workshops | Workspace | Yes |
| Check-in | Workspace | Yes |
| PT Requests | Workspace-agnostic (requests aren't bound to a location) | Yes |
| Inbox | Workspace (cancellation events tied to a location) | Yes |
| Clients | Global; read-only for Admin | Yes (read-only) |

### Why PT Requests is not filtered

`PtRequest` has no `locationId` — clients submit preferred dates / duration / instructor / note. The location is only set when the request is **scheduled** (becomes a `PtSession`). Filtering pending requests by workspace would hide work from admins. We surface a one-line hint on the page instead.

### Why Clients is global

Memory captures that Yoga Sadhana uses **cross-location credits** — a single client account spans workspaces. Filtering would fragment the customer view. Admins still see everything, just without write power.

### What we are NOT doing in this PR

- No real auth (Clerk integration deferred).
- No backend role enforcement (UI gating only).
- No per-location overrides of class types or packages (catalog stays strictly global).
- No instructor-eligibility-per-location work.
- No changes to Notifications/Waiver/Staff page internals beyond gating.
- No fe-client changes.
- No removal of `/admin/locations` route (keep the page; remove only the sidebar link).
- No removal of `LocationFilterChips` / `CheckinLocationPill` files yet — leave them in place but unused. (Cleanup in a follow-up PR.)

---

## File Structure

### New files (5)

| Path | Responsibility |
|---|---|
| `fe-portal/src/data/staff-users.ts` | Seed `StaffUser[]` (1 superadmin + 2 admins with different grants) + `currentStaffId` default |
| `fe-portal/src/lib/workspace-context.tsx` | `WorkspaceProvider`, `useWorkspace()` hook, localStorage hydration |
| `fe-portal/src/components/layout/workspace-switcher.tsx` | Topbar dropdown — current location pill, accessible-locations list, superadmin "+ Add" / "Manage" |
| `fe-portal/src/components/layout/manage-locations-dialog.tsx` | Superadmin-only modal — lists locations with edit/archive/restore (reuses `LocationFormDialog`) |
| `fe-portal/src/components/layout/dev-role-switcher.tsx` | Mockup-only affordance attached to the user pill — switch role + edit grants for demo |

### Edited files (~16)

| Path | Change |
|---|---|
| `fe-portal/src/types/index.ts` | Add `StaffRole`, `StaffUser` |
| `fe-portal/src/data/index.ts` | Re-export `staffUsers`, `currentStaffId` |
| `fe-portal/src/app/admin/layout.tsx` (or `src/app/layout.tsx`) | Wrap with `<WorkspaceProvider>` |
| `fe-portal/src/components/layout/admin-shell.tsx` | Unchanged structurally (gate still wraps) |
| `fe-portal/src/components/layout/admin-topbar.tsx` | Add `<WorkspaceSwitcher />`, swap static user pill for `<DevRoleSwitcher />` |
| `fe-portal/src/components/layout/nav-items.ts` | Add `scope: "global" \| "workspace" \| "both"`; remove Locations entry; tag others |
| `fe-portal/src/components/layout/admin-nav.tsx` | Filter NAV_ITEMS by role |
| `fe-portal/src/components/layout/location-gate.tsx` | Role-aware three-state gate |
| `fe-portal/src/app/admin/schedule/page.tsx` | Drop `LocationFilterChips`, read `activeLocationId` |
| `fe-portal/src/app/admin/packages/workshops/page.tsx` | Drop `LocationFilterChips`, read `activeLocationId` |
| `fe-portal/src/app/admin/check-in/page.tsx` | Drop `CheckinLocationPill`, read `activeLocationId` |
| `fe-portal/src/app/admin/inbox/page.tsx` | Filter events by `activeLocationId` |
| `fe-portal/src/app/admin/pt-requests/page.tsx` | Add workspace-agnostic hint banner |
| `fe-portal/src/app/admin/clients/page.tsx` | Hide "Add client" / mutation entry-points for admin |
| `fe-portal/src/app/admin/clients/[id]/page.tsx` | Pass `readOnly` prop into client component |
| `fe-portal/src/components/clients/client-profile-client.tsx` | Accept `readOnly` prop; hide kebabs, AdjustmentDialog, action buttons |
| `fe-portal/src/app/admin/locations/page.tsx` | Add role guard: if admin, render "Superadmin only" empty state |

---

## Domain Types Reference

Embed this in `fe-portal/src/types/index.ts`:

```ts
// --- Identity (staff app) ---

export type StaffRole = "superadmin" | "admin";

export interface StaffUser {
  id: string;               // matches staff_users.id
  name: string;
  email: string;
  role: StaffRole;
  // Empty array for superadmin (their grants are implicit — all active locations).
  // For admin: explicit list of location IDs they can access.
  grantedLocationIds: string[];
  archivedAt: string | null;
}
```

## WorkspaceContext API

The full surface that pages depend on:

```ts
// src/lib/workspace-context.tsx
export interface WorkspaceContextValue {
  // Identity
  currentStaff: StaffUser;
  role: StaffRole;

  // Locations
  locations: Location[];                  // all seeded locations (incl. archived)
  accessibleLocations: Location[];        // role-filtered, non-archived
  activeLocation: Location | null;
  activeLocationId: string | null;
  setActiveLocationId: (id: string) => void;

  // Location mutations (superadmin only — admin calls are no-ops in mockup)
  addLocation: (loc: Location) => void;
  updateLocation: (loc: Location) => void;
  archiveLocation: (id: string) => void;
  restoreLocation: (id: string) => void;

  // Dev affordance (mockup only)
  switchStaff: (id: string) => void;
  updateStaffGrants: (ids: string[]) => void;
}
```

### Hydration rules

1. On mount: read `ys.devCurrentStaffId` from localStorage. If absent, default to a superadmin seed.
2. Compute `accessibleLocations` = superadmin? all active : `locations.filter(l => grantedLocationIds.includes(l.id) && !l.archivedAt)`.
3. Read `ys.activeLocationId` from localStorage.
   - If present AND it's in `accessibleLocations` → use it.
   - Else if `accessibleLocations.length > 0` → auto-select `accessibleLocations[0]`.
   - Else → `null` (LocationGate will catch).
4. `setActiveLocationId` persists to `ys.activeLocationId`.
5. `switchStaff` persists `ys.devCurrentStaffId` and re-derives accessible/active.

---

## Tasks

### Task 1: Domain types — StaffRole + StaffUser

**Files:**
- Modify: `fe-portal/src/types/index.ts`

- [ ] **Step 1: Insert types after the existing `Instructor` block (around line 39)**

Add this block immediately after the `Instructor` interface:

```ts
// --- Identity (staff app) ---

export type StaffRole = "superadmin" | "admin";

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  /**
   * Locations the user can access.
   * Empty for superadmin (their grants are implicit — all active locations).
   * Explicit list for admin.
   */
  grantedLocationIds: string[];
  archivedAt: string | null;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd fe-portal && pnpm exec tsc --noEmit
```

Expected: clean (no new errors; nothing references these yet).

- [ ] **Step 3: Commit**

```bash
git add fe-portal/src/types/index.ts
git commit -m "feat(fe-portal): add StaffRole + StaffUser types"
```

---

### Task 2: Seed staff users

**Files:**
- Create: `fe-portal/src/data/staff-users.ts`
- Modify: `fe-portal/src/data/index.ts`

- [ ] **Step 1: Create the seed file**

```ts
// fe-portal/src/data/staff-users.ts
import type { StaffUser } from "@/types";

/**
 * Seed staff for the mockup. The "current logged-in" staff is determined by
 * `ys.devCurrentStaffId` in localStorage; default is `stf-super-1`.
 *
 * In production this comes from Clerk + the staff_users table.
 */
export const staffUsers: StaffUser[] = [
  {
    id: "stf-super-1",
    name: "Maya Suresh",
    email: "maya@yogasadhana.sg",
    role: "superadmin",
    grantedLocationIds: [],
    archivedAt: null,
  },
  {
    id: "stf-admin-1",
    name: "Lakshmi Iyer",
    email: "lakshmi@yogasadhana.sg",
    role: "admin",
    grantedLocationIds: ["loc-breadtalk"],
    archivedAt: null,
  },
  {
    id: "stf-admin-2",
    name: "Priya Tan",
    email: "priya@yogasadhana.sg",
    role: "admin",
    grantedLocationIds: ["loc-outram"],
    archivedAt: null,
  },
];

export const defaultStaffId = "stf-super-1";
```

- [ ] **Step 2: Export from the data barrel**

Open `fe-portal/src/data/index.ts` and append:

```ts
export { staffUsers, defaultStaffId } from "./staff-users";
```

- [ ] **Step 3: Typecheck**

```bash
cd fe-portal && pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add fe-portal/src/data/staff-users.ts fe-portal/src/data/index.ts
git commit -m "feat(fe-portal): seed staff users (1 superadmin + 2 admins)"
```

---

### Task 3: WorkspaceProvider + useWorkspace hook

**Files:**
- Create: `fe-portal/src/lib/workspace-context.tsx`

- [ ] **Step 1: Implement the provider**

```tsx
// fe-portal/src/lib/workspace-context.tsx
"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { locations as seedLocations, staffUsers as seedStaff, defaultStaffId } from "@/data";
import type { Location, StaffRole, StaffUser } from "@/types";

const STORAGE_KEY_STAFF = "ys.devCurrentStaffId";
const STORAGE_KEY_LOC = "ys.activeLocationId";

interface WorkspaceContextValue {
  currentStaff: StaffUser;
  role: StaffRole;
  locations: Location[];
  accessibleLocations: Location[];
  activeLocation: Location | null;
  activeLocationId: string | null;
  setActiveLocationId: (id: string) => void;
  addLocation: (loc: Location) => void;
  updateLocation: (loc: Location) => void;
  archiveLocation: (id: string) => void;
  restoreLocation: (id: string) => void;
  switchStaff: (id: string) => void;
  updateStaffGrants: (ids: string[]) => void;
  allStaff: StaffUser[];
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [staffList, setStaffList] = useState<StaffUser[]>(seedStaff);
  const [currentStaffId, setCurrentStaffId] = useState<string>(defaultStaffId);
  const [locations, setLocations] = useState<Location[]>(seedLocations);
  const [activeLocationId, setActiveLocationIdState] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once on mount
  useEffect(() => {
    const savedStaff = window.localStorage.getItem(STORAGE_KEY_STAFF);
    if (savedStaff && seedStaff.some((s) => s.id === savedStaff)) {
      setCurrentStaffId(savedStaff);
    }
    const savedLoc = window.localStorage.getItem(STORAGE_KEY_LOC);
    if (savedLoc) setActiveLocationIdState(savedLoc);
    setHydrated(true);
  }, []);

  const currentStaff = useMemo(
    () => staffList.find((s) => s.id === currentStaffId) ?? staffList[0],
    [staffList, currentStaffId]
  );

  const accessibleLocations = useMemo(() => {
    const active = locations.filter((l) => !l.archivedAt);
    if (currentStaff.role === "superadmin") return active;
    return active.filter((l) => currentStaff.grantedLocationIds.includes(l.id));
  }, [locations, currentStaff]);

  // Auto-select first accessible location once hydrated, if none chosen or stale.
  useEffect(() => {
    if (!hydrated) return;
    const validId =
      activeLocationId && accessibleLocations.some((l) => l.id === activeLocationId);
    if (!validId) {
      const next = accessibleLocations[0]?.id ?? null;
      setActiveLocationIdState(next);
      if (next) window.localStorage.setItem(STORAGE_KEY_LOC, next);
      else window.localStorage.removeItem(STORAGE_KEY_LOC);
    }
  }, [hydrated, accessibleLocations, activeLocationId]);

  const setActiveLocationId = useCallback((id: string) => {
    setActiveLocationIdState(id);
    window.localStorage.setItem(STORAGE_KEY_LOC, id);
  }, []);

  const addLocation = useCallback((loc: Location) => {
    setLocations((prev) => [...prev, loc]);
  }, []);

  const updateLocation = useCallback((loc: Location) => {
    setLocations((prev) => prev.map((l) => (l.id === loc.id ? loc : l)));
  }, []);

  const archiveLocation = useCallback((id: string) => {
    setLocations((prev) =>
      prev.map((l) => (l.id === id ? { ...l, archivedAt: new Date().toISOString() } : l))
    );
  }, []);

  const restoreLocation = useCallback((id: string) => {
    setLocations((prev) => prev.map((l) => (l.id === id ? { ...l, archivedAt: null } : l)));
  }, []);

  const switchStaff = useCallback((id: string) => {
    setCurrentStaffId(id);
    window.localStorage.setItem(STORAGE_KEY_STAFF, id);
  }, []);

  const updateStaffGrants = useCallback(
    (ids: string[]) => {
      setStaffList((prev) =>
        prev.map((s) => (s.id === currentStaffId ? { ...s, grantedLocationIds: ids } : s))
      );
    },
    [currentStaffId]
  );

  const activeLocation = useMemo(
    () => accessibleLocations.find((l) => l.id === activeLocationId) ?? null,
    [accessibleLocations, activeLocationId]
  );

  const value: WorkspaceContextValue = {
    currentStaff,
    role: currentStaff.role,
    locations,
    accessibleLocations,
    activeLocation,
    activeLocationId,
    setActiveLocationId,
    addLocation,
    updateLocation,
    archiveLocation,
    restoreLocation,
    switchStaff,
    updateStaffGrants,
    allStaff: staffList,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd fe-portal && pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add fe-portal/src/lib/workspace-context.tsx
git commit -m "feat(fe-portal): WorkspaceProvider + useWorkspace hook with role + active-location state"
```

---

### Task 4: Wrap the admin layout with WorkspaceProvider

**Files:**
- Modify: `fe-portal/src/app/admin/layout.tsx` (or `fe-portal/src/app/layout.tsx` if no admin-specific layout exists — check first)

- [ ] **Step 1: Locate the layout**

```bash
ls fe-portal/src/app/admin/layout.tsx 2>/dev/null || ls fe-portal/src/app/layout.tsx
```

Expected: one of them exists.

- [ ] **Step 2: Wrap children**

If `fe-portal/src/app/admin/layout.tsx` exists, edit it. Otherwise edit `fe-portal/src/app/layout.tsx`. The wrap looks like:

```tsx
import { WorkspaceProvider } from "@/lib/workspace-context";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      {/* keep existing wrappers (AdminShell etc.) here */}
      {children}
    </WorkspaceProvider>
  );
}
```

Important: `WorkspaceProvider` is a client component (`"use client"`). The app layout in Next.js can stay a server component as long as the provider is rendered as a client child. If the layout is already `"use client"`, that's fine too.

- [ ] **Step 3: Typecheck and dev-smoke**

```bash
cd fe-portal && pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add fe-portal/src/app
git commit -m "feat(fe-portal): wrap admin layout with WorkspaceProvider"
```

---

### Task 5: Workspace switcher in topbar

**Files:**
- Create: `fe-portal/src/components/layout/workspace-switcher.tsx`
- Modify: `fe-portal/src/components/layout/admin-topbar.tsx`

- [ ] **Step 1: Implement the switcher**

```tsx
// fe-portal/src/components/layout/workspace-switcher.tsx
"use client";
import { useState, useRef, useEffect } from "react";
import { MapPin, Check, Plus, Settings, ChevronDown } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { LocationFormDialog } from "@/components/locations/location-form-dialog";
import { ManageLocationsDialog } from "./manage-locations-dialog";

export function WorkspaceSwitcher() {
  const {
    role,
    accessibleLocations,
    activeLocation,
    setActiveLocationId,
    addLocation,
  } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-paper px-3 text-sm text-ink hover:border-accent/40"
      >
        <MapPin className="h-4 w-4 text-muted" />
        <span className="font-medium">{activeLocation?.name ?? "No workspace"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-border bg-card shadow-modal">
          <div className="p-1">
            {accessibleLocations.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted">No accessible locations.</div>
            )}
            {accessibleLocations.map((loc) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => {
                  setActiveLocationId(loc.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-paper"
              >
                <span className="flex-1 truncate">{loc.name}</span>
                {activeLocation?.id === loc.id && <Check className="h-4 w-4 text-accent" />}
              </button>
            ))}
          </div>

          {role === "superadmin" && (
            <>
              <div className="border-t border-border" />
              <div className="p-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(true);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-paper"
                >
                  <Plus className="h-4 w-4 text-muted" /> Add location
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowManage(true);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-paper"
                >
                  <Settings className="h-4 w-4 text-muted" /> Manage locations
                </button>
              </div>
            </>
          )}
          {role === "admin" && (
            <>
              <div className="border-t border-border" />
              <p className="px-3 py-2 text-[11px] text-muted">
                Contact your superadmin to request more workspace access.
              </p>
            </>
          )}
        </div>
      )}

      {showCreate && (
        <LocationFormDialog
          location={null}
          onClose={() => setShowCreate(false)}
          onSave={(loc) => {
            addLocation(loc);
            setActiveLocationId(loc.id);
            setShowCreate(false);
          }}
        />
      )}
      {showManage && <ManageLocationsDialog onClose={() => setShowManage(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: Wire into the topbar**

Edit `fe-portal/src/components/layout/admin-topbar.tsx`. Insert the switcher into the right-hand cluster, before the user pill. Replace the static "Admin" badge — it's now misleading.

The new topbar `return` block:

```tsx
return (
  <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/95 px-3 backdrop-blur sm:px-4 lg:px-6">
    <div className="flex min-w-0 items-center gap-2">
      <AdminMobileNavTrigger />
      <Link
        href="/admin/schedule"
        className="hidden truncate text-sm font-medium text-ink hover:text-accent sm:block"
      >
        Yoga Sadhana
      </Link>
    </div>
    <div className="flex items-center gap-2 sm:gap-3">
      <WorkspaceSwitcher />
      <div className="relative hidden md:block">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input
          placeholder="Search clients, sessions…"
          disabled
          className="h-9 w-48 pl-9 lg:w-56"
        />
      </div>
      <DevRoleSwitcher />
    </div>
  </header>
);
```

Imports to add at the top:

```ts
import { WorkspaceSwitcher } from "./workspace-switcher";
import { DevRoleSwitcher } from "./dev-role-switcher";
```

Remove the existing static user pill `<div className="flex items-center gap-2 rounded-full border border-border bg-paper ...">…</div>` — it's superseded by `<DevRoleSwitcher />` from Task 7.

- [ ] **Step 3: Typecheck**

(`ManageLocationsDialog` and `DevRoleSwitcher` don't exist yet — typecheck will fail. That's expected. Proceed to Task 6.)

- [ ] **Step 4: Commit**

```bash
git add fe-portal/src/components/layout/workspace-switcher.tsx fe-portal/src/components/layout/admin-topbar.tsx
git commit -m "feat(fe-portal): WorkspaceSwitcher in topbar"
```

---

### Task 6: ManageLocationsDialog

**Files:**
- Create: `fe-portal/src/components/layout/manage-locations-dialog.tsx`

- [ ] **Step 1: Implement**

```tsx
// fe-portal/src/components/layout/manage-locations-dialog.tsx
"use client";
import { useState } from "react";
import { Pencil, Archive, RotateCcw, Plus } from "lucide-react";
import { Dialog, Button, Badge } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { LocationFormDialog } from "@/components/locations/location-form-dialog";
import type { Location } from "@/types";

export function ManageLocationsDialog({ onClose }: { onClose: () => void }) {
  const { locations, addLocation, updateLocation, archiveLocation, restoreLocation } =
    useWorkspace();
  const [editing, setEditing] = useState<Location | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()} title="Manage locations">
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> Add location
            </Button>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {locations.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted">
                No locations yet.
              </li>
            )}
            {locations.map((loc) => (
              <li
                key={loc.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm text-ink">
                    <span className="font-medium">{loc.name}</span>
                    {loc.archivedAt && <Badge tone="neutral">Archived</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted">{loc.address}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(loc)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  {loc.archivedAt ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => restoreLocation(loc.id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => archiveLocation(loc.id)}
                    >
                      <Archive className="h-3.5 w-3.5" /> Archive
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
      {creating && (
        <LocationFormDialog
          location={null}
          onClose={() => setCreating(false)}
          onSave={(loc) => {
            addLocation(loc);
            setCreating(false);
          }}
        />
      )}
      {editing && (
        <LocationFormDialog
          location={editing}
          onClose={() => setEditing(null)}
          onSave={(loc) => {
            updateLocation(loc);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd fe-portal && pnpm exec tsc --noEmit
```

`DevRoleSwitcher` is still missing — typecheck will fail. Continue to Task 7.

- [ ] **Step 3: Commit**

```bash
git add fe-portal/src/components/layout/manage-locations-dialog.tsx
git commit -m "feat(fe-portal): ManageLocationsDialog (superadmin location CRUD modal)"
```

---

### Task 7: DevRoleSwitcher (mockup-only role + grants toggle)

**Files:**
- Create: `fe-portal/src/components/layout/dev-role-switcher.tsx`

This is a non-production affordance. Real auth will come from Clerk. The component renders as the user pill — clicking opens a small menu where you can switch the "current logged-in staff user" and (for admins) edit which locations they're granted.

- [ ] **Step 1: Implement**

```tsx
// fe-portal/src/components/layout/dev-role-switcher.tsx
"use client";
import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";

export function DevRoleSwitcher() {
  const { currentStaff, allStaff, switchStaff, locations, updateStaffGrants } =
    useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const initial = currentStaff.name.charAt(0);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-border bg-paper px-2 py-1 text-xs sm:px-3 sm:py-1.5"
      >
        <div className="h-6 w-6 rounded-full bg-accent text-center text-[11px] font-semibold leading-6 text-white">
          {initial}
        </div>
        <div className="hidden leading-tight sm:block">
          <div className="font-medium text-ink">{currentStaff.name}</div>
          <div className="text-muted capitalize">{currentStaff.role}</div>
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-72 rounded-lg border border-border bg-card shadow-modal">
          <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Demo — switch staff
          </div>
          <ul className="p-1">
            {allStaff.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => switchStaff(s.id)}
                  className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-paper ${
                    s.id === currentStaff.id ? "bg-paper" : ""
                  }`}
                >
                  <div className="flex-1">
                    <div className="font-medium text-ink">{s.name}</div>
                    <div className="text-xs text-muted capitalize">
                      {s.role}
                      {s.role === "admin" && s.grantedLocationIds.length > 0 && (
                        <>
                          {" · "}
                          {s.grantedLocationIds
                            .map(
                              (id) =>
                                locations.find((l) => l.id === id)?.name ?? "?"
                            )
                            .join(", ")}
                        </>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {currentStaff.role === "admin" && (
            <>
              <div className="border-t border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                My grants
              </div>
              <div className="space-y-1 p-2">
                {locations
                  .filter((l) => !l.archivedAt)
                  .map((l) => {
                    const granted = currentStaff.grantedLocationIds.includes(l.id);
                    return (
                      <label
                        key={l.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-paper"
                      >
                        <input
                          type="checkbox"
                          checked={granted}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...currentStaff.grantedLocationIds, l.id]
                              : currentStaff.grantedLocationIds.filter((x) => x !== l.id);
                            updateStaffGrants(next);
                          }}
                        />
                        <span>{l.name}</span>
                      </label>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd fe-portal && pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Smoke test**

```bash
cd fe-portal && pnpm dev
```

Open http://localhost:3001/admin/schedule.
- The topbar should show the workspace switcher (MapPin + location name + chevron) and the user pill (Maya Suresh · superadmin).
- Click the workspace switcher → dropdown shows Breadtalk IHQ and Outram Park, "Add location", "Manage locations".
- Click the user pill → dropdown lists all three staff. Switch to Lakshmi (admin). Topbar workspace switcher should now show only Breadtalk IHQ. No "Add"/"Manage" options.

Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add fe-portal/src/components/layout/dev-role-switcher.tsx
git commit -m "feat(fe-portal): DevRoleSwitcher (demo affordance for switching staff/role)"
```

---

### Task 8: Nav-items get a `scope` field and Locations is removed

**Files:**
- Modify: `fe-portal/src/components/layout/nav-items.ts`

- [ ] **Step 1: Replace the file**

```ts
// fe-portal/src/components/layout/nav-items.ts
import type { LucideIcon } from "lucide-react";
import {
  Tag,
  Users2,
  Shield,
  Layers,
  Heart,
  Sparkles,
  CalendarDays,
  QrCode,
  Inbox,
  HandHeart,
  Users,
  Mail,
  FileText,
  UserCog,
} from "lucide-react";

export type NavScope = "global" | "workspace" | "both";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  group: NavGroup;
  scope: NavScope;
  badgeKey?: "inboxUnread" | "ptRequestsPending";
}

export type NavGroup =
  | "Building Blocks"
  | "Policy"
  | "Packages"
  | "Schedule"
  | "Operations"
  | "Clients & Content"
  | "Admin";

export const NAV_ITEMS: NavItem[] = [
  // Locations entry removed — now lives in the topbar workspace switcher.
  { group: "Building Blocks", label: "Class Types", href: "/admin/class-types", icon: Tag, scope: "global" },
  { group: "Building Blocks", label: "Instructors", href: "/admin/instructors", icon: Users2, scope: "both" },

  { group: "Policy", label: "Global Policy", href: "/admin/policy", icon: Shield, scope: "global" },

  { group: "Packages", label: "Classes", href: "/admin/classes", icon: Layers, scope: "global" },
  { group: "Packages", label: "Workshops", href: "/admin/packages/workshops", icon: Sparkles, scope: "workspace" },
  { group: "Packages", label: "Private Sessions", href: "/admin/private-sessions", icon: Heart, scope: "global" },

  { group: "Schedule", label: "Schedule", href: "/admin/schedule", icon: CalendarDays, scope: "workspace" },

  { group: "Operations", label: "Check-in", href: "/admin/check-in", icon: QrCode, scope: "workspace" },
  {
    group: "Operations",
    label: "PT Requests",
    href: "/admin/pt-requests",
    icon: HandHeart,
    scope: "workspace",
    badgeKey: "ptRequestsPending",
  },
  { group: "Operations", label: "Inbox", href: "/admin/inbox", icon: Inbox, scope: "workspace", badgeKey: "inboxUnread" },

  { group: "Clients & Content", label: "Clients", href: "/admin/clients", icon: Users, scope: "both" },
  { group: "Clients & Content", label: "Notifications", href: "/admin/notifications", icon: Mail, scope: "global" },
  { group: "Clients & Content", label: "Waiver", href: "/admin/waiver", icon: FileText, scope: "global" },

  { group: "Admin", label: "Staff", href: "/admin/staff", icon: UserCog, scope: "global" },
];

export const NAV_GROUP_ORDER: NavGroup[] = [
  "Building Blocks",
  "Policy",
  "Packages",
  "Schedule",
  "Operations",
  "Clients & Content",
  "Admin",
];
```

- [ ] **Step 2: Typecheck**

```bash
cd fe-portal && pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add fe-portal/src/components/layout/nav-items.ts
git commit -m "refactor(fe-portal): nav scope field; remove sidebar Locations entry"
```

---

### Task 9: Admin-nav filters items by role

**Files:**
- Modify: `fe-portal/src/components/layout/admin-nav.tsx`

- [ ] **Step 1: Filter inside NavContent**

Replace the `groupedItems` constant computation with a function that runs per render (since it depends on role):

```tsx
// At top of file, after imports:
import { useWorkspace } from "@/lib/workspace-context";

// Remove the existing `groupedItems` top-level constant.

// Inside NavContent, before the return:
function NavContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { role } = useWorkspace();
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.scope === "both") return true;
    if (role === "superadmin") return true;          // superadmin sees everything
    return item.scope === "workspace";               // admin sees workspace + both
  });
  const groupedItems: Record<NavGroup, NavItem[]> = NAV_GROUP_ORDER.reduce(
    (acc, group) => {
      acc[group] = visibleItems.filter((i) => i.group === group);
      return acc;
    },
    {} as Record<NavGroup, NavItem[]>
  );

  return (
    <div className="px-2 pt-2 pb-6">
      {NAV_GROUP_ORDER.map((group) => {
        const items = groupedItems[group];
        if (items.length === 0) return null;   // hide empty groups for admin
        return (
          <div key={group} className="mb-3">
            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
              {group}
            </div>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                const badge = getBadge(item.badgeKey);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-accent/10 font-medium text-accent"
                          : "text-ink hover:bg-paper"
                      )}
                    >
                      <item.icon
                        className={cn("h-4 w-4 shrink-0", isActive ? "text-accent" : "text-muted")}
                      />
                      <span className="flex-1">{item.label}</span>
                      {badge !== undefined && (
                        <span className="inline-flex min-w-[20px] justify-center rounded-full bg-warning/20 px-1.5 py-0.5 text-[11px] font-semibold text-warning">
                          {badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and smoke**

```bash
cd fe-portal && pnpm exec tsc --noEmit && pnpm dev
```

Smoke at http://localhost:3001/admin/schedule:
- Superadmin (Maya): full sidebar — Class Types, Instructors, Policy, all Packages items, Schedule, Operations, Clients & Content, Staff. **No "Locations" link.**
- Admin (Lakshmi): sidebar shows only Instructors, Workshops, Schedule, Check-in, PT Requests, Inbox, Clients.

Stop dev.

- [ ] **Step 3: Commit**

```bash
git add fe-portal/src/components/layout/admin-nav.tsx
git commit -m "feat(fe-portal): admin-nav filters by role (admin hides global-scope items)"
```

---

### Task 10: LocationGate becomes role-aware

**Files:**
- Modify: `fe-portal/src/components/layout/location-gate.tsx`

The gate must handle three cold-start states:

1. **Superadmin, no active locations exist** → show "Add your first location" card with a button that opens `LocationFormDialog`.
2. **Admin, no accessible locations (no grants OR grants point to archived locations)** → show "No workspace access — contact your superadmin" card. No action button.
3. **Has at least one accessible location** → render `children`.

- [ ] **Step 1: Rewrite the gate**

```tsx
// fe-portal/src/components/layout/location-gate.tsx
"use client";
import { useState } from "react";
import { MapPin, Lock } from "lucide-react";
import { Button } from "@/components/ui";
import { LocationFormDialog } from "@/components/locations/location-form-dialog";
import { useWorkspace } from "@/lib/workspace-context";

export function LocationGate({ children }: { children: React.ReactNode }) {
  const { role, accessibleLocations, addLocation, setActiveLocationId } = useWorkspace();
  const [open, setOpen] = useState(false);

  if (accessibleLocations.length > 0) return <>{children}</>;

  if (role === "superadmin") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-lg rounded-2xl border border-border bg-card p-8 shadow-soft">
          <MapPin className="mb-4 h-8 w-8 text-accent" />
          <h2 className="mb-2 text-lg font-semibold text-ink">Add your first location</h2>
          <p className="mb-6 text-sm text-muted">
            Workspace-level features (Schedule, Workshops, Check-in, Inbox) need at least
            one studio location. Add one to start configuring the rest of the system.
          </p>
          <Button onClick={() => setOpen(true)}>Add location</Button>
          {open && (
            <LocationFormDialog
              location={null}
              onClose={() => setOpen(false)}
              onSave={(loc) => {
                addLocation(loc);
                setActiveLocationId(loc.id);
                setOpen(false);
              }}
            />
          )}
        </div>
      </div>
    );
  }

  // role === "admin"
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-lg rounded-2xl border border-border bg-card p-8 shadow-soft">
        <Lock className="mb-4 h-8 w-8 text-muted" />
        <h2 className="mb-2 text-lg font-semibold text-ink">No workspace access</h2>
        <p className="text-sm text-muted">
          Your account isn't granted to any location yet. Contact your superadmin to be
          added to one or more workspaces.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and smoke**

```bash
cd fe-portal && pnpm exec tsc --noEmit && pnpm dev
```

Smoke:
- Switch to an admin (Lakshmi) and uncheck all grants in DevRoleSwitcher → page should show the "No workspace access" card.
- Re-grant Breadtalk IHQ → content reappears.
- Switch back to superadmin (Maya). Archive both locations via Manage locations dialog → page shows "Add your first location" gate.
- Restore one → content reappears.

Stop dev.

- [ ] **Step 3: Commit**

```bash
git add fe-portal/src/components/layout/location-gate.tsx
git commit -m "feat(fe-portal): role-aware LocationGate"
```

---

### Task 11: Schedule page reads activeLocationId

**Files:**
- Modify: `fe-portal/src/app/admin/schedule/page.tsx`

- [ ] **Step 1: Wire context**

At the top of the file:

```tsx
import { useWorkspace } from "@/lib/workspace-context";
```

Inside the component, near the existing state declarations, replace any usage of the `LocationFilterChips` location filter (typically a `selectedLocationId` state + the `<LocationFilterChips storageKey="ys.scheduleLocationFilter" ... />` block) with:

```tsx
const { activeLocationId } = useWorkspace();
```

Then in every place that previously filtered using the chip-selected id (commonly: filtering `entries` by `entry.locationId === selectedLocationId` or a "show all" branch), replace with:

```ts
.filter((entry) => entry.locationId === activeLocationId)
```

Remove the `<LocationFilterChips ... />` JSX block from the page entirely. Also remove the import.

- [ ] **Step 2: Typecheck**

```bash
cd fe-portal && pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Smoke**

```bash
cd fe-portal && pnpm dev
```

Visit `/admin/schedule`. As superadmin (Maya), switch workspace from Breadtalk → Outram via topbar dropdown. The calendar should re-render with the other location's events only. No filter chips visible above the calendar. Stop dev.

- [ ] **Step 4: Commit**

```bash
git add fe-portal/src/app/admin/schedule/page.tsx
git commit -m "feat(fe-portal): schedule page reads activeLocationId from WorkspaceContext"
```

---

### Task 12: Workshops list reads activeLocationId

**Files:**
- Modify: `fe-portal/src/app/admin/packages/workshops/page.tsx`

- [ ] **Step 1: Replace the filter**

Same pattern as Task 11. Identify the existing `LocationFilterChips` (likely keyed `"ys.workshopsLocationFilter"`) + its corresponding filter clause. Replace with `useWorkspace().activeLocationId` and remove the chips JSX + import.

- [ ] **Step 2: Typecheck and smoke**

```bash
cd fe-portal && pnpm exec tsc --noEmit && pnpm dev
```

Smoke `/admin/packages/workshops` — switch workspace via topbar; list narrows to that location's workshops. Stop dev.

- [ ] **Step 3: Commit**

```bash
git add fe-portal/src/app/admin/packages/workshops/page.tsx
git commit -m "feat(fe-portal): workshops list reads activeLocationId from WorkspaceContext"
```

---

### Task 13: Check-in reads activeLocationId

**Files:**
- Modify: `fe-portal/src/app/admin/check-in/page.tsx`

- [ ] **Step 1: Replace local locationId state with context**

Current page has `const [locationId, setLocationId] = useState<string | null>(null);` and renders `<CheckinLocationPill value={locationId} onChange={setLocationId} />` plus a "Pick a location to start check-in" empty state.

Change to:

```tsx
import { useWorkspace } from "@/lib/workspace-context";
// ...
export default function CheckInPage() {
  const { activeLocationId, activeLocation } = useWorkspace();
  // remove: const [locationId, setLocationId] = useState<string | null>(null);
  // use activeLocationId in place of locationId everywhere below
  // remove: <CheckinLocationPill ... />
  // remove: the "Pick a location" empty-state branch (the LocationGate handles that case now)
```

Then everywhere `locationId` was referenced, use `activeLocationId`. Add a small contextual title above the active-sessions list:

```tsx
<div className="mb-4 text-xs text-muted">
  Checking in at <span className="font-medium text-ink">{activeLocation?.name}</span>.
  Switch workspaces in the topbar.
</div>
```

Remove the `import { CheckinLocationPill } ...` line.

- [ ] **Step 2: Typecheck and smoke**

```bash
cd fe-portal && pnpm exec tsc --noEmit && pnpm dev
```

Smoke `/admin/check-in`. Sessions list reacts to topbar workspace changes. The selectedKey from `useState` may stick to a stale id when switching workspaces — that's acceptable for the mockup; selectedKey will just resolve to `undefined` and the roster area collapses. Stop dev.

- [ ] **Step 3: Commit**

```bash
git add fe-portal/src/app/admin/check-in/page.tsx
git commit -m "feat(fe-portal): check-in reads activeLocationId from WorkspaceContext"
```

---

### Task 14: Inbox filters by activeLocationId

**Files:**
- Modify: `fe-portal/src/app/admin/inbox/page.tsx`

Inbox shows cancellation events. Each `InboxItem` references a class/workshop/pt session, which has a `locationId`. Filter visible items to those whose underlying session location matches `activeLocationId`.

- [ ] **Step 1: Add the filter**

```tsx
import { useWorkspace } from "@/lib/workspace-context";
import { classInstances, workshops, ptSessions } from "@/data";

// inside the component, derive event locationId per inbox item:
const { activeLocationId } = useWorkspace();

function itemLocationId(item: InboxItem): string | null {
  if (item.classInstanceId)
    return classInstances.find((c) => c.id === item.classInstanceId)?.locationId ?? null;
  if (item.workshopId) return workshops.find((w) => w.id === item.workshopId)?.locationId ?? null;
  if (item.ptSessionId) return ptSessions.find((p) => p.id === item.ptSessionId)?.locationId ?? null;
  return null;
}

// then filter:
const visibleItems = inboxItems.filter((i) => itemLocationId(i) === activeLocationId);
```

Use `visibleItems` in place of `inboxItems` in render. Be careful: `InboxItem` may not have all three ID fields — check the actual `InboxItem` type in `fe-portal/src/types/index.ts` and adapt the resolver to whatever fields it has. If the resolver returns `null` for an item, that item is hidden (acceptable — those would be system-wide events not tied to a workspace).

- [ ] **Step 2: Typecheck and smoke**

```bash
cd fe-portal && pnpm exec tsc --noEmit && pnpm dev
```

Smoke `/admin/inbox` — switching workspaces should change which cancellation events are visible. Stop dev.

- [ ] **Step 3: Commit**

```bash
git add fe-portal/src/app/admin/inbox/page.tsx
git commit -m "feat(fe-portal): inbox filters events by activeLocationId"
```

---

### Task 15: PT Requests page workspace-agnostic note

**Files:**
- Modify: `fe-portal/src/app/admin/pt-requests/page.tsx`

PT requests have no `locationId`. Add a small hint under the page header so it's clear the list is global.

- [ ] **Step 1: Add the hint**

Inside the `return` block, immediately under `<PageHeader ... />`, insert:

```tsx
<div className="rounded-md border border-border bg-paper px-3 py-2 text-xs text-muted">
  PT requests aren't tied to a workspace — the location is set when the request is scheduled.
</div>
```

- [ ] **Step 2: Typecheck**

```bash
cd fe-portal && pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add fe-portal/src/app/admin/pt-requests/page.tsx
git commit -m "feat(fe-portal): note workspace-agnostic nature of PT requests"
```

---

### Task 16: Clients page — read-only mode for admin

**Files:**
- Modify: `fe-portal/src/app/admin/clients/page.tsx`
- Modify: `fe-portal/src/app/admin/clients/[id]/page.tsx`
- Modify: `fe-portal/src/components/clients/client-profile-client.tsx`

- [ ] **Step 1: List page — gate "Add client" button**

In `fe-portal/src/app/admin/clients/page.tsx`, find the page header action(s). Add:

```tsx
"use client";
// ...
import { useWorkspace } from "@/lib/workspace-context";

// inside the component:
const { role } = useWorkspace();
const canWrite = role === "superadmin";
```

Wrap any "Add client" / "Import" / mutation entry-point with `{canWrite && ...}`.

If the page is currently a server component (no `"use client"`), convert to a client component for this gate.

- [ ] **Step 2: Pass `readOnly` into the profile client**

In `fe-portal/src/app/admin/clients/[id]/page.tsx`, the page hands off to `<ClientProfileClient ... />`. Find that line and add a `readOnly` prop derived from `role`. Because the dynamic route page may be a server component, do this via a tiny client wrapper or by reading role inside `ClientProfileClient` itself. Simpler: read role inside `ClientProfileClient` directly with `useWorkspace()` and derive `readOnly` there.

- [ ] **Step 3: Apply read-only inside `client-profile-client.tsx`**

```tsx
// near the top of the component:
const { role } = useWorkspace();
const readOnly = role === "admin";
```

Then everywhere a mutation entry-point exists (kebab on package rows, "Edit expiry", "Set credit balance", "Manual adjustment", "Add credits", "Add package" — anywhere it appears in the existing implementation), wrap with `{!readOnly && ...}`. Also disable the AdjustmentDialog mount path under `readOnly`.

Add a banner at the top of the profile when `readOnly`:

```tsx
{readOnly && (
  <div className="mb-4 rounded-md border border-border bg-paper px-3 py-2 text-xs text-muted">
    Read-only view — only superadmin can modify client packages and credits.
  </div>
)}
```

- [ ] **Step 4: Typecheck and smoke**

```bash
cd fe-portal && pnpm exec tsc --noEmit && pnpm dev
```

Smoke:
- As superadmin (Maya): `/admin/clients/<some-id>` shows all kebabs, add buttons, adjustment dialog works.
- Switch to admin (Lakshmi): same page shows the read-only banner, no kebabs, no action buttons.
- Stop dev.

- [ ] **Step 5: Commit**

```bash
git add fe-portal/src/app/admin/clients fe-portal/src/components/clients/client-profile-client.tsx
git commit -m "feat(fe-portal): clients read-only for admin role; superadmin retains write"
```

---

### Task 17: Locations page guard (sidebar entry already removed)

**Files:**
- Modify: `fe-portal/src/app/admin/locations/page.tsx`

The `/admin/locations` route still exists (referenced by some legacy links and the workspace-switcher's "Manage locations" routes via the modal, not the page). But a curious admin who types the URL should not be able to view it.

- [ ] **Step 1: Add guard**

At the top of the page component:

```tsx
"use client";
import { useWorkspace } from "@/lib/workspace-context";
import { Lock } from "lucide-react";

// inside the component, before existing logic:
const { role } = useWorkspace();
if (role !== "superadmin") {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-soft">
        <Lock className="mx-auto mb-4 h-8 w-8 text-muted" />
        <h2 className="mb-2 text-lg font-semibold text-ink">Superadmin only</h2>
        <p className="text-sm text-muted">
          Location management is a global setting. Ask your superadmin to make changes.
        </p>
      </div>
    </div>
  );
}
```

If the page was a server component, convert to client. If the page uses dynamic data via server-side fetching, hoist the guard into a thin client wrapper component instead.

- [ ] **Step 2: Typecheck and smoke**

```bash
cd fe-portal && pnpm exec tsc --noEmit && pnpm dev
```

Smoke: as admin, navigate manually to `/admin/locations` → "Superadmin only" card. Stop dev.

- [ ] **Step 3: Commit**

```bash
git add fe-portal/src/app/admin/locations/page.tsx
git commit -m "feat(fe-portal): /admin/locations gated to superadmin"
```

---

### Task 18: Final verification

- [ ] **Step 1: Typecheck**

```bash
cd fe-portal && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Build**

```bash
cd fe-portal && pnpm build
```

Expected: build succeeds. Route manifest should still include all existing routes (no removals — only nav gating).

- [ ] **Step 3: Manual smoke checklist**

Start dev (`pnpm dev`) and run through:

- **Superadmin (Maya, default)**
  - [ ] Topbar shows MapPin pill (current location), search box, user pill (Maya · superadmin)
  - [ ] Workspace switcher lists Breadtalk IHQ + Outram Park + "Add location" + "Manage locations"
  - [ ] Sidebar has full nav. "Locations" entry is gone.
  - [ ] Schedule, Workshops, Check-in, Inbox all react to workspace switch in topbar
  - [ ] Clients profile shows kebabs and adjustment dialogs
  - [ ] "Manage locations" dialog opens; archive Breadtalk → schedule for Breadtalk events disappears for that workspace; restore → it returns
- **Admin (Lakshmi, granted Breadtalk)**
  - [ ] Sidebar shows only: Instructors, Workshops, Schedule, Check-in, PT Requests, Inbox, Clients
  - [ ] Workspace switcher shows only Breadtalk IHQ; no "Add"/"Manage"; footer hint "Contact your superadmin"
  - [ ] Clients profile shows the read-only banner; no kebabs/adjustment buttons
  - [ ] `/admin/locations`, `/admin/class-types`, `/admin/classes`, `/admin/policy` etc. (if reached directly) — class-types/policy/classes still render (no per-page guards added), but they're hidden from nav. (Optional follow-up: per-page guards.)
- **Admin with zero grants** (uncheck Breadtalk in DevRoleSwitcher)
  - [ ] LocationGate shows "No workspace access"
- **Superadmin with all locations archived**
  - [ ] LocationGate shows "Add your first location"
  - [ ] Adding a location through the gate auto-selects it and reveals the rest of the UI

- [ ] **Step 4: Final commit (cleanup or none)**

If smoke is clean and nothing required additional fixes, this task creates no commit. Just confirm green.

---

## Spec Coverage Self-Check

| Requirement | Task |
|---|---|
| Role enum (superadmin/admin) | Task 1 |
| Seed staff users for demo | Task 2 |
| Workspace state context with role + active location | Task 3 |
| Provider wraps admin layout | Task 4 |
| Topbar workspace dropdown (replaces sidebar Locations) | Tasks 5, 6 |
| Demo role/grant switcher | Task 7 |
| Sidebar `Locations` entry removed | Task 8 |
| Sidebar items role-filtered | Tasks 8, 9 |
| Schedule reads active location | Task 11 |
| Workshops list reads active location | Task 12 |
| Check-in reads active location | Task 13 |
| Inbox filters by active location | Task 14 |
| PT requests workspace-agnostic notice | Task 15 |
| Clients read-only for admin, write for superadmin | Task 16 |
| `/admin/locations` guarded | Task 17 |
| LocationGate role-aware (superadmin cold start vs admin no-access) | Task 10 |
| Build + typecheck clean, manual smoke | Task 18 |

## Known Follow-ups (not in this PR)

- Per-page guards for global-scope routes (`/admin/class-types`, `/admin/classes`, `/admin/policy`, etc.) — admin can't reach them via sidebar but typing the URL still works. Add guards mirroring Task 17 if defence-in-depth is desired.
- Remove `LocationFilterChips` and `CheckinLocationPill` files once we're confident nothing references them.
- Real Clerk auth + backend role enforcement.
- Workshops are tied to a location via `locationId` — when a superadmin archives a location, existing workshop seeds for that location are now orphaned in the Workshops list (they get filtered out by `activeLocationId`). Production behaviour should be to disallow archiving while active workshops/schedules exist; defer that policy.
