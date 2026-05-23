# Client Catalog Surfacing + Auth Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface live class schedule + PT availability + locations in fe-client (BE reads currently 501, FE on mock), and wire a coherent Clerk auth experience (built-in password reset + route-protection middleware).

**Architecture:** New BE service `services/schedule/client-catalog.ts` serializes active class instances and PT availability (dedicated Drizzle queries exposing `credit_cost` + `capacity_online`, mirroring the workshops catalog service). Thin Hono handlers replace the 501 stubs at `/public/classes*`, `/public/locations`, `/me/classes`, `/me/instructors/:id/availability`. fe-client gets a `src/lib/classes.ts` data layer (mirrors `lib/workshops.ts`) consumed by a rewired `/classes` page and `/private-sessions`. Auth: delete dead custom reset pages (Clerk's `<SignIn>` hosts reset), add `src/middleware.ts`.

**Tech Stack:** Hono + Drizzle + Postgres + Zod (BE); Next.js App Router + Clerk + Tailwind (fe-client).

**Scope guard (do NOT implement):** booking/checkout writes (`POST /me/bookings/*`, PT request submit), Stripe, refunds, `/me/me` profile + dashboard + `/me/bookings/*`. Account pages stay on mock-state. The class "Book" / PT "Request" actions surface a "coming soon" affordance — they do NOT call the stubbed write endpoints.

**Testing note:** The BE has **no test runner** and zero existing tests. We are NOT bolting on a harness for read-only endpoints this pass. BE correctness gate = `npm run build` (tsc, strict) passes + a documented `curl` against the locally seeded dev DB. fe-client gate = `npm run build` + `npm run lint`.

**Reference facts (verified):**
- Route mounts (`be/src/app.ts`): `app.route('/api/v1/public', publicRoutes)`, `app.route('/api/v1/me', clientRoutes)`. Each index does `.route('/', catalog)` → real paths have **no** `/catalog` segment.
- Client middleware (`be/src/middleware/clerk-client.ts`) sets `c.get('clientId')` (clients.id UUID), `c.get('clerkClaims')`, `c.get('clientRow')`.
- `classes` table (`be/src/db/schema/schedule.ts`): `id, classTypeId, instructorId, locationId, roomId(nullable), startsAt, endsAt, capacityOnline, capacityWaitlist, capacityBuffer, creditCost, lifecycle('active'|'cancelled'|'archived'), ...`. **No difficulty/level column.**
- `bookings` (`be/src/db/schema/bookings.ts`): `id, clientId, kind('class'|'workshop'|'pt'), classId(nullable), state('confirmed'|...), bookedAt`.
- `locations` (`catalog.ts`): `id, name, address, gmapsUrl, phone, archivedAt`. Active = `archivedAt IS NULL`.
- `rooms`: `id, locationId, name, capacity, archivedAt`. `classTypes`: `id, name, description, parentId, archivedAt`. `instructors`: `staffUserId(PK), bio, photoR2Key, phone` — name via `staffUsers.name`.
- `ptBookingConfig` (`be/src/db/schema/policy.ts`): singleton id `00000000-0000-0000-0000-000000000002`, field `bookInAdvanceDays`.
- `ptSessions`: `id, instructorId, locationId(nullable), roomId, startsAt, endsAt, sessionType('1on1'|'2on1'), capacityOnline/Waitlist/Buffer, lifecycle`.
- `NotFoundError` (`be/src/shared/errors.ts`) → mapped to 404 by `errorBoundary` (`be/src/middleware/error.ts`).
- fe-client API helper (`fe-client/src/lib/api.ts`): `useApi()` (authed), `publicApi` (anon); `.get(path, query?)`. Paths are prefixed with `/api/v1` internally — pass `/public/classes`, `/me/classes`, etc.

---

## File Structure

**BE — create:**
- `be/src/services/schedule/client-catalog.ts` — class card/detail + locations + PT availability serializers.

**BE — modify:**
- `be/src/routes/public/catalog.ts` — implement `/locations`, `/classes`, `/classes/:id`.
- `be/src/routes/client/catalog.ts` — implement `/classes`, `/instructors/:id/availability`.

**fe-client — create:**
- `fe-client/src/lib/classes.ts` — wire types + `useClasses`, `useClass`, `useLocations`, `useClassEntitlements` hooks + helpers.
- `fe-client/src/middleware.ts` — Clerk route protection.

**fe-client — modify:**
- `fe-client/src/app/(client)/classes/page.tsx` — swap mock → live; drop level filter; real "today".
- `fe-client/src/app/(client)/private-sessions/page.tsx` — locations + instructor availability from live BE.

**fe-client — delete:**
- `fe-client/src/app/(client)/forgot-password/` and `.../reset-password/` (dead shells).

**docs — create:**
- `docs/md/clerk-client-setup.md` — required Clerk dashboard settings for email verification + password reset.

---

## Task 1: BE client-catalog service — class cards + detail

**Files:**
- Create: `be/src/services/schedule/client-catalog.ts`

- [ ] **Step 1: Write the service module**

Create `be/src/services/schedule/client-catalog.ts`:

```ts
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import { classes, ptSessions } from '../../db/schema/schedule'
import { classTypes, instructors, locations, rooms } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { ptBookingConfig } from '../../db/schema/policy'
import { NotFoundError } from '../../shared/errors'

export interface LocationLite {
  id: string
  name: string
  address: string | null
}

export interface ClassCardPayload {
  id: string
  class_type: { id: string; name: string }
  instructor: { id: string; name: string }
  location: LocationLite | null
  room: { id: string; name: string } | null
  starts_at: string
  ends_at: string
  credit_cost: number
  capacity_online: number
  booked_count: number
  spots_left: number
  lifecycle: string
}

export interface ClassDetailPayload extends ClassCardPayload {
  class_type: { id: string; name: string; description: string | null }
  location: { id: string; name: string; address: string | null; gmaps_url: string | null } | null
}

export interface ClassListFilters {
  from?: Date
  to?: Date
  locationId?: string
  instructorId?: string
  classTypeId?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Default window: start of today → +28 days. Range hard-capped at 90 days. */
export function resolveWindow(from?: Date, to?: Date): { from: Date; to: Date } {
  const start = from ?? new Date(new Date().setHours(0, 0, 0, 0))
  let end = to ?? new Date(start.getTime() + 28 * DAY_MS)
  if (end.getTime() - start.getTime() > 90 * DAY_MS) {
    end = new Date(start.getTime() + 90 * DAY_MS)
  }
  return { from: start, to: end }
}

async function bookedCountByClass(classIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (classIds.length === 0) return map
  const rows = await db
    .select({ classId: bookings.classId, cnt: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(inArray(bookings.classId, classIds), eq(bookings.state, 'confirmed')))
    .groupBy(bookings.classId)
  for (const r of rows) if (r.classId) map.set(r.classId, Number(r.cnt))
  return map
}

export async function listClassCards(filters: ClassListFilters): Promise<ClassCardPayload[]> {
  const { from, to } = resolveWindow(filters.from, filters.to)
  const conds = [
    eq(classes.lifecycle, 'active'),
    gte(classes.endsAt, from),
    lt(classes.startsAt, to),
  ]
  if (filters.locationId) conds.push(eq(classes.locationId, filters.locationId))
  if (filters.instructorId) conds.push(eq(classes.instructorId, filters.instructorId))
  if (filters.classTypeId) conds.push(eq(classes.classTypeId, filters.classTypeId))

  const rows = await db
    .select({
      id: classes.id,
      classTypeId: classes.classTypeId,
      className: classTypes.name,
      instructorId: classes.instructorId,
      instructorName: staffUsers.name,
      locationId: classes.locationId,
      locationName: locations.name,
      locationAddress: locations.address,
      roomId: classes.roomId,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      creditCost: classes.creditCost,
      capacityOnline: classes.capacityOnline,
      lifecycle: classes.lifecycle,
    })
    .from(classes)
    .innerJoin(classTypes, eq(classes.classTypeId, classTypes.id))
    .innerJoin(instructors, eq(classes.instructorId, instructors.staffUserId))
    .innerJoin(staffUsers, eq(instructors.staffUserId, staffUsers.id))
    .innerJoin(locations, eq(classes.locationId, locations.id))
    .where(and(...conds))
    .orderBy(classes.startsAt)

  const roomIds = Array.from(new Set(rows.map(r => r.roomId).filter((v): v is string => !!v)))
  const roomById = new Map<string, { id: string; name: string }>()
  if (roomIds.length) {
    const rrows = await db
      .select({ id: rooms.id, name: rooms.name })
      .from(rooms)
      .where(inArray(rooms.id, roomIds))
    for (const r of rrows) roomById.set(r.id, { id: r.id, name: r.name })
  }

  const booked = await bookedCountByClass(rows.map(r => r.id))

  return rows.map(r => {
    const bookedCount = booked.get(r.id) ?? 0
    return {
      id: r.id,
      class_type: { id: r.classTypeId, name: r.className },
      instructor: { id: r.instructorId, name: r.instructorName || 'Instructor' },
      location: { id: r.locationId, name: r.locationName, address: r.locationAddress },
      room: r.roomId ? roomById.get(r.roomId) ?? null : null,
      starts_at: r.startsAt.toISOString(),
      ends_at: r.endsAt.toISOString(),
      credit_cost: r.creditCost,
      capacity_online: r.capacityOnline,
      booked_count: bookedCount,
      spots_left: Math.max(0, r.capacityOnline - bookedCount),
      lifecycle: r.lifecycle,
    }
  })
}

export async function getClassDetail(id: string): Promise<ClassDetailPayload> {
  const [r] = await db
    .select({
      id: classes.id,
      classTypeId: classes.classTypeId,
      className: classTypes.name,
      classDescription: classTypes.description,
      instructorId: classes.instructorId,
      instructorName: staffUsers.name,
      locationId: classes.locationId,
      locationName: locations.name,
      locationAddress: locations.address,
      gmapsUrl: locations.gmapsUrl,
      roomId: classes.roomId,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      creditCost: classes.creditCost,
      capacityOnline: classes.capacityOnline,
      lifecycle: classes.lifecycle,
    })
    .from(classes)
    .innerJoin(classTypes, eq(classes.classTypeId, classTypes.id))
    .innerJoin(instructors, eq(classes.instructorId, instructors.staffUserId))
    .innerJoin(staffUsers, eq(instructors.staffUserId, staffUsers.id))
    .innerJoin(locations, eq(classes.locationId, locations.id))
    .where(eq(classes.id, id))
    .limit(1)

  if (!r || r.lifecycle !== 'active') throw new NotFoundError('class_not_found')

  let room: { id: string; name: string } | null = null
  if (r.roomId) {
    const [rr] = await db
      .select({ id: rooms.id, name: rooms.name })
      .from(rooms)
      .where(eq(rooms.id, r.roomId))
      .limit(1)
    room = rr ?? null
  }

  const booked = (await bookedCountByClass([r.id])).get(r.id) ?? 0

  return {
    id: r.id,
    class_type: { id: r.classTypeId, name: r.className, description: r.classDescription },
    instructor: { id: r.instructorId, name: r.instructorName || 'Instructor' },
    location: {
      id: r.locationId,
      name: r.locationName,
      address: r.locationAddress,
      gmaps_url: r.gmapsUrl,
    },
    room,
    starts_at: r.startsAt.toISOString(),
    ends_at: r.endsAt.toISOString(),
    credit_cost: r.creditCost,
    capacity_online: r.capacityOnline,
    booked_count: booked,
    spots_left: Math.max(0, r.capacityOnline - booked),
    lifecycle: r.lifecycle,
  }
}

/** Returns the set of class IDs (from the given list) the client has a confirmed booking for. */
export async function myBookedClassIds(clientId: string, classIds: string[]): Promise<Set<string>> {
  if (classIds.length === 0) return new Set()
  const rows = await db
    .select({ classId: bookings.classId })
    .from(bookings)
    .where(
      and(
        eq(bookings.clientId, clientId),
        eq(bookings.state, 'confirmed'),
        inArray(bookings.classId, classIds),
      ),
    )
  const out = new Set<string>()
  for (const r of rows) if (r.classId) out.add(r.classId)
  return out
}

export async function listActiveLocations(): Promise<
  { id: string; name: string; address: string | null; gmaps_url: string | null; phone: string | null }[]
> {
  const rows = await db
    .select({
      id: locations.id,
      name: locations.name,
      address: locations.address,
      gmapsUrl: locations.gmapsUrl,
      phone: locations.phone,
    })
    .from(locations)
    .where(sql`${locations.archivedAt} is null`)
    .orderBy(locations.name)
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    address: r.address,
    gmaps_url: r.gmapsUrl,
    phone: r.phone,
  }))
}

export interface PtSlotPayload {
  id: string
  starts_at: string
  ends_at: string
  session_type: '1on1' | '2on1'
  spots_left: number
}

async function getBookInAdvanceDays(): Promise<number> {
  const [cfg] = await db
    .select({ days: ptBookingConfig.bookInAdvanceDays })
    .from(ptBookingConfig)
    .limit(1)
  return cfg?.days ?? 14
}

export async function listInstructorAvailability(instructorId: string): Promise<PtSlotPayload[]> {
  const days = await getBookInAdvanceDays()
  const now = new Date()
  const until = new Date(now.getTime() + days * DAY_MS)

  const rows = await db
    .select({
      id: ptSessions.id,
      startsAt: ptSessions.startsAt,
      endsAt: ptSessions.endsAt,
      sessionType: ptSessions.sessionType,
      capacityOnline: ptSessions.capacityOnline,
    })
    .from(ptSessions)
    .where(
      and(
        eq(ptSessions.instructorId, instructorId),
        eq(ptSessions.lifecycle, 'active'),
        gte(ptSessions.startsAt, now),
        lt(ptSessions.startsAt, until),
      ),
    )
    .orderBy(ptSessions.startsAt)

  return rows.map(r => ({
    id: r.id,
    starts_at: r.startsAt.toISOString(),
    ends_at: r.endsAt.toISOString(),
    session_type: r.sessionType as '1on1' | '2on1',
    spots_left: r.capacityOnline, // PT capacity is per-session; booked clients tracked separately
  }))
}
```

> If `classes`, `ptSessions` are not both exported from `../../db/schema/schedule`, or `classTypes/instructors/locations/rooms` from `../../db/schema/catalog`, adjust imports to match the actual export sites (verify against `be/src/db/schema/index.ts`). The barrel `../../db/schema` re-exports all — importing from it (as `timetable.ts` does) is also fine.

- [ ] **Step 2: Type-check**

Run: `cd be && npx tsc --noEmit`
Expected: PASS (no errors). Fix any import/type mismatches surfaced.

- [ ] **Step 3: Commit**

```bash
git add be/src/services/schedule/client-catalog.ts
git commit -m "feat(be): client-catalog service for classes, locations, PT availability"
```

---

## Task 2: Wire public class + location endpoints

**Files:**
- Modify: `be/src/routes/public/catalog.ts`

- [ ] **Step 1: Add imports + zod query schema at top of file**

After the existing imports in `be/src/routes/public/catalog.ts`, add:

```ts
import { z } from 'zod'
import * as classCatalog from '../../services/schedule/client-catalog'

const classesQuery = z.object({
  location_id: z.string().uuid().optional(),
  instructor_id: z.string().uuid().optional(),
  class_type_id: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

function parseClassFilters(raw: Record<string, string | undefined>): classCatalog.ClassListFilters {
  const q = classesQuery.parse(raw)
  return {
    locationId: q.location_id,
    instructorId: q.instructor_id,
    classTypeId: q.class_type_id,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
  }
}
```

- [ ] **Step 2: Replace the three 501 stubs**

Replace these lines:

```ts
  .get('/locations', c => c.json({ todo: 'list active locations' }, 501))
  .get('/classes', c => c.json({ todo: 'list classes (filter location/date/instructor/type)' }, 501))
  .get('/classes/:id', c => c.json({ todo: 'class detail' }, 501))
```

with:

```ts
  .get('/locations', async c => {
    const locations = await classCatalog.listActiveLocations()
    return c.json({ locations })
  })
  .get('/classes', async c => {
    const filters = parseClassFilters(c.req.query())
    const classes = await classCatalog.listClassCards(filters)
    return c.json({ classes })
  })
  .get('/classes/:id', async c => {
    const detail = await classCatalog.getClassDetail(c.req.param('id'))
    return c.json(detail)
  })
```

- [ ] **Step 3: Type-check**

Run: `cd be && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual verification against seeded dev DB**

Run (BE dev server in another shell via `cd be && npm run dev`):
```bash
curl -s "http://localhost:4000/api/v1/public/locations" | head -c 400
curl -s "http://localhost:4000/api/v1/public/classes" | head -c 600
```
Expected: JSON `{ "locations": [...] }` with seeded studios; `{ "classes": [...] }` with class cards carrying `spots_left` and `credit_cost`. Pick an `id` from the list:
```bash
curl -s "http://localhost:4000/api/v1/public/classes/<id>" | head -c 600
```
Expected: detail object including `class_type.description` and `location.gmaps_url`. A bogus id returns HTTP 404 `{"error":"class_not_found"}`.

- [ ] **Step 5: Commit**

```bash
git add be/src/routes/public/catalog.ts
git commit -m "feat(be): public classes + locations catalog endpoints"
```

---

## Task 3: Wire authed class + PT availability endpoints

**Files:**
- Modify: `be/src/routes/client/catalog.ts`

- [ ] **Step 1: Add imports + query schema**

After existing imports in `be/src/routes/client/catalog.ts`, add:

```ts
import { z } from 'zod'
import * as classCatalog from '../../services/schedule/client-catalog'

const meClassesQuery = z.object({
  location_id: z.string().uuid().optional(),
  instructor_id: z.string().uuid().optional(),
  class_type_id: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})
```

- [ ] **Step 2: Replace the `/classes` 501 stub**

Replace:
```ts
  .get('/classes', c => c.json({ todo: 'classes browse with auth (include_my_bookings)' }, 501))
```
with:
```ts
  .get('/classes', async c => {
    const clientId = c.get('clientId')
    const q = meClassesQuery.parse(c.req.query())
    const cards = await classCatalog.listClassCards({
      locationId: q.location_id,
      instructorId: q.instructor_id,
      classTypeId: q.class_type_id,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    })
    const bookedIds = await classCatalog.myBookedClassIds(
      clientId,
      cards.map(card => card.id),
    )
    return c.json({
      classes: cards.map(card => ({ ...card, is_booked: bookedIds.has(card.id) })),
    })
  })
```

- [ ] **Step 3: Replace the `/instructors/:id/availability` 501 stub**

Replace:
```ts
  .get('/instructors/:id/availability', c =>
    c.json({ todo: 'instructor availability slot enumeration for PT picker' }, 501),
  )
```
with:
```ts
  .get('/instructors/:id/availability', async c => {
    const slots = await classCatalog.listInstructorAvailability(c.req.param('id'))
    return c.json({ slots })
  })
```

- [ ] **Step 4: Type-check + manual verify**

Run: `cd be && npx tsc --noEmit` → PASS.
With a client Clerk JWT in `$TOKEN`:
```bash
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:4000/api/v1/me/classes" | head -c 600
```
Expected: `{ "classes": [...] }` where each card has `is_booked: false/true`.

- [ ] **Step 5: Commit**

```bash
git add be/src/routes/client/catalog.ts
git commit -m "feat(be): authed classes (is_booked) + PT availability endpoints"
```

---

## Task 4: fe-client data layer — `src/lib/classes.ts`

**Files:**
- Create: `fe-client/src/lib/classes.ts`

- [ ] **Step 1: Write the module**

Create `fe-client/src/lib/classes.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { ApiError, publicApi, useApi } from "./api";

export interface ApiClassLocation {
  id: string;
  name: string;
  address: string | null;
}

export interface ApiClassCard {
  id: string;
  class_type: { id: string; name: string };
  instructor: { id: string; name: string };
  location: ApiClassLocation | null;
  room: { id: string; name: string } | null;
  starts_at: string;
  ends_at: string;
  credit_cost: number;
  capacity_online: number;
  booked_count: number;
  spots_left: number;
  lifecycle: string;
  is_booked?: boolean;
}

export interface ApiClassDetail extends ApiClassCard {
  class_type: { id: string; name: string; description: string | null };
  location:
    | { id: string; name: string; address: string | null; gmaps_url: string | null }
    | null;
}

export interface ApiLocationFull {
  id: string;
  name: string;
  address: string | null;
  gmaps_url: string | null;
  phone: string | null;
}

export interface ClassFilters {
  location_id?: string;
  instructor_id?: string;
  class_type_id?: string;
  from?: string;
  to?: string;
}

export function useClasses(filters: ClassFilters): {
  data: ApiClassCard[] | null;
  loading: boolean;
  error: ApiError | Error | null;
} {
  const { isLoaded, isSignedIn } = useUser();
  const api = useApi();
  const [data, setData] = useState<ApiClassCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);

  // Stable dep key so the effect re-runs only when a filter actually changes.
  const key = JSON.stringify(filters);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(filters)) if (v) query[k] = v;
    (async () => {
      try {
        const res = isSignedIn
          ? await api.get<{ classes: ApiClassCard[] }>("/me/classes", query)
          : await publicApi.get<{ classes: ApiClassCard[] }>("/public/classes", query);
        if (!cancelled) setData(res.classes);
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, api, key]);

  return { data, loading, error };
}

export function useClass(id: string | undefined): {
  data: ApiClassDetail | null;
  loading: boolean;
  error: ApiError | Error | null;
} {
  const { isLoaded, isSignedIn } = useUser();
  const api = useApi();
  const [data, setData] = useState<ApiClassDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);

  useEffect(() => {
    if (!isLoaded || !id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = isSignedIn
          ? await api.get<ApiClassDetail>(`/me/classes/${id}`)
          : await publicApi.get<ApiClassDetail>(`/public/classes/${id}`);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isLoaded, isSignedIn, api]);

  return { data, loading, error };
}

export function useLocations(): {
  data: ApiLocationFull[] | null;
  loading: boolean;
} {
  const [data, setData] = useState<ApiLocationFull[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await publicApi.get<{ locations: ApiLocationFull[] }>("/public/locations");
        if (!cancelled) setData(res.locations);
      } catch {
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return { data, loading };
}

export interface ClassEntitlements {
  trial_used: boolean;
  has_active_unlimited: boolean;
  has_active_bundle_credits: boolean;
}

/** Whether the signed-in client currently holds something that can pay for a class. */
export function useCanBookClass(): { canBook: boolean; loaded: boolean } {
  const { isLoaded, isSignedIn } = useUser();
  const api = useApi();
  const [ent, setEnt] = useState<ClassEntitlements | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setEnt(null);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ entitlements: ClassEntitlements }>("/me/class-packages");
        if (!cancelled) setEnt(res.entitlements);
      } catch {
        if (!cancelled) setEnt(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, api]);

  const canBook = !!ent && (ent.has_active_unlimited || ent.has_active_bundle_credits);
  return { canBook, loaded };
}

// ── Date/time helpers (live data is ISO; group/display by local day) ──────────

export function toLocalDateStr(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatClassTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-SG", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function durationMinutes(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}
```

- [ ] **Step 2: Type-check**

Run: `cd fe-client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add fe-client/src/lib/classes.ts
git commit -m "feat(fe-client): live classes data layer (hooks + types)"
```

---

## Task 5: Rewire `/classes` page to live BE

**Files:**
- Modify: `fe-client/src/app/(client)/classes/page.tsx`

**Context:** The page currently imports `sessions.json`, `instructors.json`, `useMockState`, `getTenantLocations`, `getLocationName`, with a hardcoded `TODAY = new Date(2026, 4, 9)` and a "level" filter. We replace the data source with `useClasses`/`useLocations`/`useCanBookClass`, use the real current date, drop the level filter (no difficulty in schema), and make the Book CTA honest (signed-out → login; signed-in + entitled → "coming soon"; signed-in + not entitled → existing buy-package modal). Booked instances show a "Booked" badge via `is_booked`.

- [ ] **Step 1: Replace the import + module-constant block (lines 1–59)**

Replace everything from the top of the file through the `LEVEL_LABELS` constant (the block ending at the line `};` after the `advanced` entry) with:

```tsx
"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useClasses,
  useLocations,
  useCanBookClass,
  toLocalDateStr,
  formatClassTime,
  durationMinutes,
  type ApiClassCard,
} from "@/lib/classes";
import { useUser } from "@clerk/nextjs";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getMonthGrid(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - startOffset + i));
}
```

> The old `toDateStr` helper is replaced by `toLocalDateStr` from `@/lib/classes`. The old `getInstructorName` is gone — the card carries `instructor.name`.

- [ ] **Step 2: Rewrite `ClassRow` to consume `ApiClassCard`**

Replace the entire `ClassRow` component with one typed on `ApiClassCard`. Key changes: `session` → `cls: ApiClassCard`; time from `formatClassTime(cls.starts_at)`; duration from `durationMinutes`; instructor from `cls.instructor.name`; location from `cls.location?.name`; full check `cls.spots_left <= 0`; credit text uses `cls.credit_cost`; the booking gate uses the `useCanBookClass` hook and `useUser`; a "Booked" pill renders when `cls.is_booked`. Use:

```tsx
function ClassRow({
  cls,
  showLocation,
  canBook,
  isSignedIn,
}: {
  cls: ApiClassCard;
  showLocation: boolean;
  canBook: boolean;
  isSignedIn: boolean;
}) {
  const router = useRouter();
  const [showNoPackage, setShowNoPackage] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showSoon, setShowSoon] = useState(false);
  const isFull = cls.spots_left <= 0;
  const locationName = cls.location?.name ?? null;

  const handleBookClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isSignedIn) {
      router.push(`/login?next=${encodeURIComponent("/classes")}`);
      return;
    }
    if (!canBook) {
      setShowNoPackage(true);
      return;
    }
    // Online class booking write is not implemented this pass (BE returns 501).
    setShowSoon(true);
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-ink/10 bg-paper transition-all hover:shadow-hover",
        "px-4 py-3 md:px-5 md:py-4",
        "flex flex-col gap-2 md:grid md:grid-cols-[96px_1.4fr_1fr_minmax(160px,auto)_auto] md:items-center md:gap-4",
        isFull && "opacity-60",
      )}
    >
      {/* Time + duration (mobile + desktop) */}
      <div className="flex items-center justify-between md:hidden">
        <div className="flex items-baseline gap-2">
          <span className={cn("text-sm font-semibold tracking-tight", isFull ? "text-muted" : "text-ink")}>
            {formatClassTime(cls.starts_at)}
          </span>
          <span className="text-[10px] text-muted font-mono">
            {durationMinutes(cls.starts_at, cls.ends_at)} min
          </span>
        </div>
        <span className="inline-flex items-center rounded-full bg-sage/15 text-accent-deep px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider">
          {cls.class_type.name}
        </span>
      </div>

      <div className="hidden md:flex md:flex-col">
        <span className={cn("text-[15px] font-semibold tracking-tight", isFull ? "text-muted" : "text-ink")}>
          {formatClassTime(cls.starts_at)}
        </span>
        <span className="text-[11px] text-muted font-mono">
          {durationMinutes(cls.starts_at, cls.ends_at)} min
        </span>
      </div>

      <div className="hidden md:flex md:flex-col">
        <span className="inline-flex items-center self-start rounded-full bg-sage/15 text-accent-deep px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider mb-1">
          {cls.class_type.name}
        </span>
        <h4 className={cn("font-serif text-[15px] leading-snug", isFull ? "text-muted" : "text-ink")}>
          {cls.class_type.name}
        </h4>
        <p className="text-xs text-muted mt-0.5">{cls.instructor.name}</p>
      </div>

      <div className="md:hidden">
        <h4 className={cn("font-serif text-base leading-snug", isFull ? "text-muted" : "text-ink")}>
          {cls.class_type.name}
        </h4>
        <p className="text-xs text-muted mt-0.5">
          {cls.instructor.name}
          {showLocation && locationName && (
            <>
              <span className="mx-1.5 text-ink/20">·</span>
              {locationName}
            </>
          )}
        </p>
      </div>

      <div className="hidden md:flex md:flex-col">
        <span className="text-xs text-ink font-medium">{cls.instructor.name}</span>
        {showLocation && locationName && (
          <span className="text-[11px] text-muted mt-0.5">{locationName}</span>
        )}
      </div>

      <div className="hidden md:block text-right">
        <p className="text-[11px] text-muted">{cls.credit_cost} credit{cls.credit_cost === 1 ? "" : "s"}</p>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); setShowDetails(true); }}
          className="inline-flex items-center gap-1 text-xs font-medium mt-0.5 text-muted hover:text-ink transition-colors"
        >
          <HelpCircle size={12} />
          Learn more
        </button>
      </div>

      <div className="hidden md:flex justify-end">
        {cls.is_booked ? (
          <span className="inline-flex items-center justify-center rounded-full bg-sage/20 text-accent-deep px-5 py-2 text-xs font-medium">
            Booked
          </span>
        ) : isFull ? (
          <span className="inline-flex items-center justify-center rounded-full bg-warm text-muted border border-border px-5 py-2 text-xs">
            Full
          </span>
        ) : (
          <button
            onClick={handleBookClick}
            className="inline-flex items-center justify-center rounded-full px-5 py-2 text-xs font-medium transition-colors bg-accent text-white hover:bg-accent-deep"
          >
            Book Now
          </button>
        )}
      </div>

      {/* Mobile CTA row */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-ink/5 md:hidden">
        <span className="text-[11px] text-muted">{cls.credit_cost} credit{cls.credit_cost === 1 ? "" : "s"}</span>
        {cls.is_booked ? (
          <span className="inline-flex items-center justify-center rounded-full bg-sage/20 text-accent-deep px-4 py-1.5 text-xs font-medium">Booked</span>
        ) : isFull ? (
          <span className="inline-flex items-center justify-center rounded-full bg-warm text-muted border border-border px-4 py-1.5 text-xs">Full</span>
        ) : (
          <button
            onClick={handleBookClick}
            className="inline-flex items-center justify-center rounded-full px-4 py-1.5 text-xs font-medium bg-accent text-white hover:bg-accent-deep transition-colors"
          >
            Book Now
          </button>
        )}
      </div>

      {showDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4" onClick={() => setShowDetails(false)}>
          <div className="bg-paper rounded-2xl p-8 max-w-md w-full shadow-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif text-xl text-ink leading-snug">{cls.class_type.name}</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted mt-1.5">
              <span>{cls.instructor.name}</span>
              <span>·</span>
              <span>{durationMinutes(cls.starts_at, cls.ends_at)} min</span>
              {locationName && (<><span>·</span><span>{locationName}</span></>)}
            </div>
            <p className="text-[11px] text-muted mt-4 font-mono uppercase tracking-wider">
              {cls.credit_cost} credit{cls.credit_cost === 1 ? "" : "s"} required · {cls.spots_left} spot{cls.spots_left === 1 ? "" : "s"} left
            </p>
            <button onClick={() => setShowDetails(false)} className="mt-6 w-full rounded-full border border-ink/10 py-2.5 text-sm text-muted hover:text-ink transition-colors">Close</button>
          </div>
        </div>
      )}

      {showNoPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4" onClick={() => setShowNoPackage(false)}>
          <div className="bg-paper rounded-2xl p-8 max-w-sm w-full shadow-modal text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif text-xl text-ink leading-snug">You need a package to book a class</h3>
            <p className="text-sm text-muted mt-2 leading-relaxed">You&apos;re out of credits. Grab a package to keep booking.</p>
            <div className="mt-6 flex flex-col gap-2">
              <button onClick={() => router.push("/packages")} className="w-full rounded-full bg-accent text-white py-3 text-sm font-semibold hover:bg-accent-deep transition-colors">Buy a package</button>
              <button onClick={() => setShowNoPackage(false)} className="w-full rounded-full border border-ink/10 py-2.5 text-sm text-muted hover:text-ink transition-colors">Not now</button>
            </div>
          </div>
        </div>
      )}

      {showSoon && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4" onClick={() => setShowSoon(false)}>
          <div className="bg-paper rounded-2xl p-8 max-w-sm w-full shadow-modal text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif text-xl text-ink leading-snug">Online booking is coming soon</h3>
            <p className="text-sm text-muted mt-2 leading-relaxed">You can browse the live schedule now — class booking opens shortly.</p>
            <button onClick={() => setShowSoon(false)} className="mt-6 w-full rounded-full border border-ink/10 py-2.5 text-sm text-muted hover:text-ink transition-colors">Got it</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `ClassesPage` body — live data, real today, no level filter**

Replace the `ClassesPage` function. Default the calendar to the real current month/day; fetch the visible month's classes via `useClasses({ from, to, location_id, instructor_id })`; derive instructor options and the date-dot set from the fetched list; remove the level `FilterSelect`. Keep `FilterSelect` component as-is. Use:

```tsx
export default function ClassesPage() {
  const today = useMemo(() => new Date(), []);
  const todayStr = toLocalDateStr(today.toISOString());

  const [calMonth, setCalMonth] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [instructor, setInstructor] = useState("");

  const showLocationBadge = !selectedLocation;
  const calDays = useMemo(() => getMonthGrid(calMonth.year, calMonth.month), [calMonth]);

  // Fetch the visible month (plus padding) so calendar dots + day list share one query.
  const monthFrom = new Date(calMonth.year, calMonth.month, 1).toISOString();
  const monthTo = new Date(calMonth.year, calMonth.month + 1, 1).toISOString();
  const { data: classes, loading } = useClasses({
    from: monthFrom,
    to: monthTo,
    location_id: selectedLocation || undefined,
    instructor_id: instructor || undefined,
  });
  const { data: locations } = useLocations();
  const { isSignedIn } = useUser();
  const { canBook } = useCanBookClass(); // fetched once for the page, passed to each row

  const all = useMemo(() => classes ?? [], [classes]);

  const instructorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of all) seen.set(c.instructor.id, c.instructor.name);
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [all]);

  const dateDotSet = useMemo(() => new Set(all.map((c) => toLocalDateStr(c.starts_at))), [all]);

  const classesForDay = useMemo(
    () =>
      all
        .filter((c) => toLocalDateStr(c.starts_at) === selectedDate)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [all, selectedDate],
  );

  const monthLabel = `${MONTH_NAMES[calMonth.month]} ${calMonth.year}`;
  const selectedDateLabel = new Date(selectedDate + "T00:00:00").toLocaleDateString("en-SG", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  function goToPrevMonth() {
    setCalMonth(({ year, month }) => (month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }));
  }
  function goToNextMonth() {
    setCalMonth(({ year, month }) => (month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }));
  }
  function goToToday() {
    setCalMonth({ year: today.getFullYear(), month: today.getMonth() });
    setSelectedDate(todayStr);
  }

  return (
    <div id="schedule">
      <BookingSurface maxWidth="xl" padding="default">
        <SectionHeading eyebrow="Schedule" title="Book a class" description="Pick a day, filter the schedule, and reserve your spot." />

        {/* Calendar — reuse the existing markup from the previous version, swapping:
            TODAY_STR -> todayStr, SESSION_DATE_SET -> dateDotSet, calMonth/handlers unchanged.
            Keep the header, day-of-week row, and 6x7 grid exactly as before. */}
        {/* ...calendar block (unchanged structure)... */}

        <p className="font-serif text-base text-ink mb-4">{selectedDateLabel}</p>

        <div className="flex flex-wrap gap-2 mb-6">
          <FilterSelect
            value={selectedLocation}
            onChange={setSelectedLocation}
            options={(locations ?? []).map((l) => ({ value: l.id, label: l.name }))}
            placeholder="All locations"
          />
          <FilterSelect
            value={instructor}
            onChange={setInstructor}
            options={instructorOptions}
            placeholder="All instructors"
          />
        </div>

        <div className="flex flex-col gap-3">
          {loading ? (
            <div className="text-center py-16 text-sm text-muted">Loading schedule…</div>
          ) : classesForDay.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted">No classes scheduled for this day.</div>
          ) : (
            classesForDay.map((c) => (
              <ClassRow
                key={c.id}
                cls={c}
                showLocation={showLocationBadge}
                canBook={canBook}
                isSignedIn={!!isSignedIn}
              />
            ))
          )}
        </div>
      </BookingSurface>
    </div>
  );
}
```

> Keep the existing calendar JSX block verbatim from the prior version, only replacing `TODAY_STR` → `todayStr` and `SESSION_DATE_SET.has(ds)` → `dateDotSet.has(ds)`. Everything else (grid math, prev/next handlers) is unchanged.

- [ ] **Step 4: Type-check + lint + build**

Run: `cd fe-client && npx tsc --noEmit && npm run lint`
Expected: PASS. Resolve unused-import warnings (e.g. removed `formatTime`, `getTenantLocations`).

- [ ] **Step 5: Manual verify**

Start fe-client (`npm run dev`, port 3000) with BE running. Visit `/classes` signed-out: live schedule renders, calendar dots match days that have classes, location/instructor filters work. Sign in: `is_booked` classes show a "Booked" pill. Click "Book Now" signed-out → redirected to `/login?next=/classes`.

- [ ] **Step 6: Commit**

```bash
git add "fe-client/src/app/(client)/classes/page.tsx"
git commit -m "feat(fe-client): wire /classes to live schedule; drop mock + level filter"
```

---

## Task 6: Rewire `/private-sessions` instructor + location data

**Files:**
- Modify: `fe-client/src/app/(client)/private-sessions/page.tsx`

**Context:** The page currently builds PT slots from `instructors.json`/`locations.json` with hardcoded windows. Read the file first, then swap the data sources: instructor + location lists from `useLocations()` and the PT package catalog already wired on `/packages`, and the availability picker from `/me/instructors/:id/availability` via a new hook. The request-submit action stays stubbed (BE 501) — keep the existing submit handler but route it to a "coming soon" affordance like the classes page (do NOT call the stubbed endpoint).

- [ ] **Step 1: Add a PT availability hook to `src/lib/classes.ts`**

Append to `fe-client/src/lib/classes.ts`:

```ts
export interface ApiPtSlot {
  id: string;
  starts_at: string;
  ends_at: string;
  session_type: "1on1" | "2on1";
  spots_left: number;
}

export function useInstructorAvailability(instructorId: string | undefined): {
  data: ApiPtSlot[] | null;
  loading: boolean;
} {
  const { isLoaded, isSignedIn } = useUser();
  const api = useApi();
  const [data, setData] = useState<ApiPtSlot[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !instructorId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await api.get<{ slots: ApiPtSlot[] }>(
          `/me/instructors/${instructorId}/availability`,
        );
        if (!cancelled) setData(res.slots);
      } catch {
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [instructorId, isLoaded, isSignedIn, api]);
  return { data, loading };
}
```

- [ ] **Step 2: Swap the page's data sources**

In `private-sessions/page.tsx`: replace `locations.json` usage with `useLocations()`; replace any hardcoded instructor list with the instructors surfaced by PT packages / availability; replace the synthetic slot generator with `useInstructorAvailability(selectedInstructorId)`. Preserve the existing layout, calendar, and styling. Where the page previously decremented mock credits / created a mock booking on submit, replace with a "Private session requests are coming soon" modal (mirror `showSoon` from Task 5). Keep the PT package pricing display (already live via `/packages`).

- [ ] **Step 3: Type-check + lint**

Run: `cd fe-client && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Manual verify**

Visit `/private-sessions` signed-in: real locations in the filter; selecting an instructor shows live availability slots (empty state if none seeded). Submit shows the "coming soon" modal, not a fake confirmation.

- [ ] **Step 5: Commit**

```bash
git add fe-client/src/lib/classes.ts "fe-client/src/app/(client)/private-sessions/page.tsx"
git commit -m "feat(fe-client): live PT availability + locations on /private-sessions"
```

---

## Task 7: Add Clerk route-protection middleware

**Files:**
- Create: `fe-client/src/middleware.ts`

- [ ] **Step 1: Write the middleware**

Create `fe-client/src/middleware.ts`:

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtected = createRouteMatcher(["/account(.*)", "/checkout"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) {
    const { userId } = await auth();
    if (!userId) {
      const signIn = new URL("/login", req.url);
      signIn.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
      return NextResponse.redirect(signIn);
    }
  }
});

export const config = {
  matcher: [
    // Skip Next internals and static files unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
```

> `/classes`, `/workshops(.*)`, `/packages`, `/pricing`, `/private-sessions(.*)` are intentionally NOT in `isProtected` — they stay public per the spec. `clerkMiddleware` still runs on them (so `useUser()` works) but does not redirect.

- [ ] **Step 2: Build (middleware compiles only at build/runtime)**

Run: `cd fe-client && npm run build`
Expected: PASS. Then `npm run dev`, visit `/account` signed-out → redirected to `/login?next=/account`. Sign in → `/account` loads.

- [ ] **Step 3: Commit**

```bash
git add fe-client/src/middleware.ts
git commit -m "feat(fe-client): clerkMiddleware protecting /account and /checkout"
```

---

## Task 8: Remove dead password-reset pages; use Clerk built-in

**Files:**
- Delete: `fe-client/src/app/(client)/forgot-password/`
- Delete: `fe-client/src/app/(client)/reset-password/`

- [ ] **Step 1: Find inbound links to the dead routes**

Run: search the fe-client source for references.
Grep pattern: `forgot-password|reset-password` across `fe-client/src`.
Expected: note every match (e.g. a "Forgot password?" `<Link>` in a custom auth component, if any). Clerk's `<SignIn>` provides its own reset link, so any custom link should be removed rather than repointed.

- [ ] **Step 2: Delete the directories**

```bash
git rm -r "fe-client/src/app/(client)/forgot-password" "fe-client/src/app/(client)/reset-password"
```

- [ ] **Step 3: Remove any orphaned links found in Step 1**

For each match, delete the `<Link href="/forgot-password">…</Link>` (or `/reset-password`) element. If a match is only in the now-deleted files, nothing to do.

- [ ] **Step 4: Build + lint**

Run: `cd fe-client && npm run build && npm run lint`
Expected: PASS, no broken-import or dead-link errors. Visit `/login`, click "Forgot password?" inside the Clerk widget → Clerk's hosted reset (email + code) appears.

- [ ] **Step 5: Commit**

```bash
git add -A "fe-client/src/app/(client)"
git commit -m "chore(fe-client): drop dead custom reset pages; use Clerk built-in reset"
```

---

## Task 9: Document required Clerk dashboard settings

**Files:**
- Create: `docs/md/clerk-client-setup.md`

- [ ] **Step 1: Write the doc**

Create `docs/md/clerk-client-setup.md`:

```markdown
# Clerk — client app setup (member-facing)

The BE sends **no** auth emails. Clerk (the `CLERK_CLIENT_*` app) hosts all of them — sign-up
verification and password-reset codes. "When emails get sent" is therefore a Clerk
**dashboard** configuration, not BE code. Configure the client Clerk application:

## Email & verification
- **User & Authentication → Email, Phone, Username:** Email address required; enable
  **Verify at sign-up** with **Email verification code** (matches the BE `requireVerified`
  gate, which blocks booking writes until email + phone are verified).
- **Phone:** required + verified (so `requireVerified` can pass for bookings, a later pass).

## Password reset
- **User & Authentication → Password:** enable **"Allow users to reset their password"** via
  **email verification code**. This is the flow surfaced by the `<SignIn>` widget's
  "Forgot password?" link — no custom pages needed.

## Paths & redirects
- **Paths:** Sign-in URL `/login`, Sign-up URL `/register` (must match `ClerkProvider` props
  in `fe-client/src/app/layout.tsx`).
- **Allowed origins / redirect URLs:** include the fe-client origin (local `http://localhost:3000`
  and the Vercel production URL).

## Email templates
- Review the **Verification code** and **Reset password code** templates under
  **Customization → Emails** for Yoga Sadhana branding.

## Keys (already provisioned per CLAUDE.md)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` set in the fe-client Vercel project.
- The BE verifies client JWTs with `CLERK_CLIENT_SECRET_KEY` (+ optional
  `CLERK_CLIENT_AUTHORIZED_PARTIES`); never share keys with the staff app.
```

- [ ] **Step 2: Commit**

```bash
git add docs/md/clerk-client-setup.md
git commit -m "docs: required Clerk client-app dashboard settings"
```

---

## Task 10: Verification pass on workshops & packages

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Workshops**

With BE + fe-client running, visit `/workshops` and a detail page signed-out and signed-in. Confirm: cards show min price + discount badge when a promotion/early-bird applies; detail shows days, tiers (with early-bird strike pricing via `tierEffectivePrice`), instructors, images. Note any mismatch.

- [ ] **Step 2: Packages**

Visit `/packages`. Confirm class-credit, unlimited, trial, PT 1-on-1 and 2-on-1 packages render with `effective_price_sgd` and promotion labels. Signed in: trial pass reflects `entitlements.trial_used` (claimed → not offered again); unlimited/bundle entitlement display correct.

- [ ] **Step 2b: Fix only real defects**

If Step 1/2 surface a rendering bug, fix it in the relevant page/lib file, re-run `cd fe-client && npm run build`, and commit with a `fix(fe-client): …` message. If everything renders correctly, record "verified, no changes" and skip the commit.

---

## Final verification

- [ ] `cd be && npx tsc --noEmit` → PASS
- [ ] `cd fe-client && npm run build && npm run lint` → PASS
- [ ] Manual: `/classes` (public + signed-in), `/private-sessions`, `/workshops`, `/packages` render live data; `/account` redirects when signed-out; Clerk reset reachable from `<SignIn>`.
- [ ] Spec scope respected: no booking/checkout writes implemented; account pages still on mock.
