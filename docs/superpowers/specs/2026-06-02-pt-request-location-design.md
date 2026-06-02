# PT Request Location — Design

**Date:** 2026-06-02
**Status:** Approved

## Problem

Clients submitting a Personal Training (PT) request cannot specify which studio
location the session is for. The portal PT Requests page shows every request
"across all locations" and ignores the workspace switcher. Staff want requests
to carry a location at submission time and to filter the portal list by the
location selected in the workspace dropdown.

This reverses the prior design decision ("clients pick their location when the
session is scheduled").

## Context / current state

- All PT request paths are **mock/seed on the FE** and **`501` on the BE**.
  - `be/src/routes/client/pt-sessions.ts` — all routes 501.
  - `be/src/services/pt-sessions/request.ts` — `submitPtRequest` throws "not implemented".
- `fe-client` already has a live `useLocations()` hook (`/public/locations`),
  used by the classes filter — the request form can reuse it.
- `fe-portal` workspace switcher (`useWorkspace().activeLocation`) is **live**
  (real location UUIDs from `/portal/auth/me`), while the PT Requests page is
  **seed-only** (`@/data`, seed ids `loc-breadtalk` / `loc-outram`).

## Decisions

- **Scope:** FE + BE schema plumbing. BE routes stay 501; the `locationId`
  field is threaded through schema + service interface so it is ready when the
  routes land.
- **Portal filter:** strict — show only requests for the active workspace
  location (no "all" escape).

## Changes

### BE
1. `be/src/db/schema/schedule.ts` — add `locationId` to `ptRequests`
   (`uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' })`),
   mirroring `classes` / `ptSessions`. Add index `pt_requests_location_status_idx`
   on `(locationId, status)`.
2. `be/src/db/migrations/0011_pt_request_location.sql` — hand-authored
   (convention: no `drizzle-kit generate`). `ALTER TABLE pt_requests ADD COLUMN
   location_id uuid NOT NULL REFERENCES locations(id)` + create index. Table is
   empty (route 501) so `NOT NULL` is safe.
3. `be/src/services/pt-sessions/request.ts` — add `locationId: string` to
   `PtRequestInput`.

### fe-client
4. `lib/pt-requests-mock.ts` — add `locationId` + `locationName` to
   `LocalPtRequest` and the submit input.
5. `app/(client)/private-sessions/request/page.tsx` — required Location
   dropdown (above Class type) from `useLocations()`; default to first location;
   validation error if unset; include `locationId` + `locationName` in payload.
6. `app/(client)/account/private-sessions` list + `[id]` detail — display the
   request's location name.

### fe-portal
7. `types/index.ts` — add `locationId: string` to `PtRequest`.
8. `data/pt-requests.ts` — add `locationId` to each seed row, split across
   `loc-breadtalk` / `loc-outram`.
9. `app/admin/pt-requests/page.tsx` — filter list + per-tab counts by
   `useWorkspace().activeLocation`. Replace the "across all locations" banner
   with an active-location indicator. **Seed-era bridge:** resolve
   `activeLocation` → seed location id by name match, with a `TODO` to switch to
   a direct `activeLocation.id` comparison once the BE list endpoint lands.
10. `components/pt-requests/pt-request-drawer.tsx` — show location.
    `components/pt-requests/schedule-from-request-dialog.tsx` — default location
    selection to the request's location.

### Docs
- Update PT sections of `be-client.md`, `be-portal.md`,
  `fe-client-features.md`, `admin-restructure.md`.

## Verification (lint is broken in this repo)
- BE: `npm run typecheck --prefix be`
- fe-client / fe-portal: `tsc --noEmit` + `next build`
