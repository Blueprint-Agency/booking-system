# Corporate Package + Main/Supporting Instructors — Design

**Date:** 2026-05-23
**Status:** Draft, pending user review.

---

## 1. Summary

Two coupled changes shipped as one spec:

1. **Corporate Package** — a new package type, visible to portal staff only. Configured at *Admin → Packages → Corporate* (name / description / price). Scheduled onto the unified schedule via a new "+ Corporate" action with five fields: corporate package template, room, client name, when (start/end), instructor. **Invisible on fe-client** — members never see it; nothing is ever sold through it; no fe-client bookings reference it.
2. **Main + supporting instructors** — every scheduled *class*, *workshop*, and *corporate session* gains the shape **1 main instructor + 0..N supporting instructors**. PT sessions are explicitly excluded — they keep their existing single-instructor model.

---

## 2. Assumed defaults (flag any that are wrong)

Items the user did not explicitly call out. These are taken to avoid further back-and-forth; flag in review if any are wrong.

| # | Decision | Default taken |
|---|---|---|
| D1 | Corporate template name/desc/price at scheduling time | **Frozen reference** from the template at schedule time. No per-session price overrides, no "actual amount paid" field. |
| D2 | Corporate session lifecycle | Same enum as classes: `active` / `cancelled`. Cancellable and reschedulable by admin. |
| D3 | Corporate package status | Same enum as other packages: `active` / `archived`. Archiving hides from the scheduling picker but preserves history. |
| D4 | Corporate sessions on the unified schedule | Yes — appear on Day/Week/Month views with a new color (slate/neutral), new legend entry "Corporate", new filter pill value "corporate". |
| D5 | "+ Corporate" UI on schedule | Same dropdown pattern as Workshop — opens a list of active corporate packages; picking one routes to `/admin/schedule/new/corporate?packageId=…` which shows the form (room / client name / when / main instructor / supporting instructors). |
| D6 | fe-client visibility of supporting instructors | **Show all instructors** on class/workshop detail pages, with the main instructor first / visually emphasized. Supporting instructors render as a smaller secondary list. Corporate sessions never reach fe-client regardless. |
| D7 | Teaching log entries | Written for **main + supporting** on classes/workshops/corporate. Lets the studio see who taught what; payroll reconciliation stays out-of-app (per existing memory). |
| D8 | Promotions on corporate | **Not supported.** `promotionParentEnum` is NOT extended for corporate. Corporate has no fe-client purchase flow, so promotion mechanics don't apply. |
| D9 | Capacity / credit_cost on corporate sessions | **Neither exists.** No attendee roster (confirmed), no bookings table rows reference the session, no credit deduction. Corporate sessions are pure calendar blocks. |
| D10 | Conflict checks on corporate sessions | Same as classes/workshops: prevent room double-booking and main-instructor double-booking. Supporting instructors do NOT block scheduling — they can be on overlapping sessions (assistants frequently float). |
| D11 | Filter pill behavior | Existing "Instructor" filter matches if either main OR supporting is the selected instructor. |
| D12 | Migration of existing rows | Existing `classes.instructor_id` becomes the main instructor; the column is renamed `main_instructor_id`. Existing `workshop_instructors` rows are migrated to `main` role for the first row per workshop (by stable ordering), `supporting` for the rest. |

---

## 3. Scope

### In scope

- Backend schema + migrations for: `corporate_packages`, `corporate_sessions`, main/supporting instructor restructuring on `classes` and `workshops`.
- Backend routes under `/portal/admin/corporate-packages` and `/portal/admin/corporate-sessions`, plus updates to existing class/workshop CRUD to accept supporting instructors.
- Schedule aggregator (`/portal/admin/schedule`) extended to emit `corporate` entries.
- Portal UI: new sidebar item "Corporate", new catalog page, new schedule action + creation form, updates to class create/edit and workshop edit forms.
- fe-client class detail + workshop detail: render main + supporting instructors.
- Migration scripts that backfill `main_instructor_id` and `role` columns from existing data.

### Out of scope

- Anything making corporate visible to fe-client (no listing, no purchase, no entitlement, no `client_packages` rows, no bookings).
- PT session restructuring — single-instructor model retained.
- Pay rates / payouts / statements — out-of-app per existing memory.
- Reporting/analytics surfaces (no aggregate revenue report in this spec; consume via the catalog row prices if needed externally).
- Promotions for corporate (per D8).

---

## 4. Data model

### 4.1 New: `corporate_packages`

```ts
export const corporatePackages = pgTable(
  'corporate_packages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    description: text('description'),
    priceSgd: numeric('price_sgd', { precision: 10, scale: 2 }).notNull(),
    status: packageStatusEnum('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdByStaffId: uuid('created_by_staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'restrict' }),
  },
  table => ({
    statusIdx: index('corporate_packages_status_idx').on(table.status),
    pricePositive: check('corporate_packages_price_positive', sql`${table.priceSgd} >= 0`),
  }),
)
```

Reuses the existing `packageStatusEnum`. No `kind` column — corporate is a flat catalog. Lives in `be/src/db/schema/packages.ts` alongside the other package tables.

### 4.2 New: `corporate_sessions`

```ts
export const corporateSessions = pgTable(
  'corporate_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    corporatePackageId: uuid('corporate_package_id')
      .notNull()
      .references(() => corporatePackages.id, { onDelete: 'restrict' }),
    clientName: text('client_name').notNull(),     // free-text corporate buyer label
    mainInstructorId: uuid('main_instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    roomId: uuid('room_id')
      .notNull()                                    // required at DB level — every corp session is a room block
      .references(() => rooms.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    lifecycle: lifecycleEnum('lifecycle').notNull().default('active'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByStaffId: uuid('cancelled_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdByStaffId: uuid('created_by_staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'restrict' }),
  },
  table => ({
    startsAtIdx: index('corporate_sessions_starts_at_idx').on(table.startsAt),
    instructorStartsIdx: index('corporate_sessions_instructor_starts_idx').on(
      table.mainInstructorId,
      table.startsAt,
    ),
    locationStartsIdx: index('corporate_sessions_location_starts_idx').on(
      table.locationId,
      table.startsAt,
    ),
    roomStartsIdx: index('corporate_sessions_room_starts_idx').on(table.roomId, table.startsAt),
    lifecycleStartsIdx: index('corporate_sessions_lifecycle_starts_idx').on(
      table.lifecycle,
      table.startsAt,
    ),
    endsAfterStarts: check(
      'corporate_sessions_ends_after_starts',
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
  }),
)
```

Lives in `be/src/db/schema/schedule.ts` alongside the other scheduled-entity tables.

### 4.3 Main/supporting instructor restructure

#### `classes` — rename column

- Rename `classes.instructor_id` → `classes.main_instructor_id` (still NOT NULL, still references `instructors.staff_user_id`). The existing index `classes_instructor_starts_idx` is renamed to `classes_main_instructor_starts_idx`.

#### New: `class_supporting_instructors`

```ts
export const classSupportingInstructors = pgTable(
  'class_supporting_instructors',
  {
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'restrict' }),
  },
  table => ({
    pk: primaryKey({ columns: [table.classId, table.instructorId] }),
    instructorIdx: index('class_supporting_instructors_instructor_idx').on(table.instructorId),
  }),
)
```

App-level guard: a supporting instructor row may NOT duplicate the main instructor for the same class (rejected at the service layer with a 400; not encoded as a DB check to keep the cross-table constraint simple).

#### `workshop_instructors` — add `role` column

Replace the existing flat junction with a role-aware one:

```ts
export const workshopInstructorRoleEnum = pgEnum('workshop_instructor_role', [
  'main',
  'supporting',
])

export const workshopInstructors = pgTable(
  'workshop_instructors',
  {
    workshopId: uuid('workshop_id').notNull().references(() => workshops.id, { onDelete: 'cascade' }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'cascade' }),
    role: workshopInstructorRoleEnum('role').notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.workshopId, table.instructorId] }),
    // Partial unique index: exactly one 'main' row per workshop.
    mainUnique: uniqueIndex('workshop_instructors_main_unique')
      .on(table.workshopId)
      .where(sql`role = 'main'`),
    workshopRoleIdx: index('workshop_instructors_workshop_role_idx').on(table.workshopId, table.role),
  }),
)
```

App-level guard at workshop create/update: payload must contain exactly one main and 0..N distinct supporting instructors.

#### New: `corporate_session_supporting_instructors`

```ts
export const corporateSessionSupportingInstructors = pgTable(
  'corporate_session_supporting_instructors',
  {
    corporateSessionId: uuid('corporate_session_id')
      .notNull()
      .references(() => corporateSessions.id, { onDelete: 'cascade' }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'restrict' }),
  },
  table => ({
    pk: primaryKey({ columns: [table.corporateSessionId, table.instructorId] }),
    instructorIdx: index('corporate_session_supporting_instructors_instructor_idx').on(table.instructorId),
  }),
)
```

Same app-level guard as classes: supporting row may not duplicate the main.

### 4.4 Migration

Single migration file ordering:

1. `CREATE TABLE corporate_packages`.
2. `CREATE TABLE corporate_sessions` + indexes.
3. `CREATE TABLE class_supporting_instructors`.
4. `CREATE TABLE corporate_session_supporting_instructors`.
5. `ALTER TABLE classes RENAME COLUMN instructor_id TO main_instructor_id;` + rename index.
6. `CREATE TYPE workshop_instructor_role AS ENUM ('main', 'supporting');`.
7. `ALTER TABLE workshop_instructors ADD COLUMN role workshop_instructor_role;`.
8. Backfill: per workshop, the lowest `(workshop_id, instructor_id)` tuple by `instructor_id` text-sort becomes `main`; everything else becomes `supporting`. Deterministic and reproducible.
9. `ALTER TABLE workshop_instructors ALTER COLUMN role SET NOT NULL;`.
10. `CREATE UNIQUE INDEX workshop_instructors_main_unique ...`.

No backward-compat code is needed in the BE — Drizzle is regenerated from the new schema and routes/services are updated in the same PR.

---

## 5. Backend (`be/`) changes

### 5.1 New routes

#### `/portal/admin/corporate-packages` (file: `be/src/routes/portal/admin/corporate-packages.ts`)

| Method | Path | Behavior |
|---|---|---|
| GET | `/` | List all (active + archived); `?status=active` filter. |
| POST | `/` | Create — body `{ name, description?, priceSgd }`. |
| GET | `/:id` | Fetch one. |
| PATCH | `/:id` | Update name / description / price / status (toggle archive). Setting `status='archived'` stamps `archivedAt`. |
| DELETE | `/:id` | Soft-delete via archive; hard delete only if no `corporate_sessions` reference. Returns 409 if in use. |

Wired in `be/src/routes/portal/admin/index.ts`.

#### `/portal/admin/corporate-sessions` (file: `be/src/routes/portal/admin/corporate-sessions.ts`)

| Method | Path | Behavior |
|---|---|---|
| POST | `/` | Create — body `{ corporatePackageId, clientName, mainInstructorId, supportingInstructorIds?[], locationId, roomId, startsAt, endsAt }`. Validates: package is `active`, room belongs to location, main not in supporting list, no main-instructor or room conflict in the time range. |
| GET | `/:id` | Fetch (with package, instructors, room hydrated). |
| PATCH | `/:id` | Reschedule (start/end/room/instructor changes). Same conflict checks. |
| POST | `/:id/cancel` | Set `lifecycle='cancelled'`, stamp `cancelledAt` / `cancelledByStaffId`. |
| DELETE | `/:id` | Hard-delete only if not referenced anywhere (currently no other tables reference it; reserved for future safety). |

Wired in `be/src/routes/portal/admin/index.ts`.

#### Schedule aggregator update — `be/src/routes/portal/admin/schedule.ts`

Add corporate as a 4th branch alongside class / workshop / pt. Emit shape:

```ts
{
  kind: 'corporate',
  id: corporateSession.id,
  label: corporatePackage.name,          // e.g. "Corporate 60min Vinyasa"
  subtitle: corporateSession.clientName, // e.g. "DBS Bank"
  startsAt, endsAt,
  locationId, roomId,
  mainInstructorId,
  supportingInstructorIds: string[],
  instructorIds: [main, ...supporting],  // for client-side filter compatibility
  eventState: lifecycle === 'cancelled' ? 'cancelled' : 'active',
  raw: { ... },
}
```

Filter param `?type=corporate` and instructor filter applies if either main or supporting matches.

### 5.2 Existing route updates

- `POST /portal/admin/classes` and `PATCH /portal/admin/classes/:id` — accept optional `supportingInstructorIds: string[]`. Service writes the junction inside the same transaction as the class row. Conflict check unchanged (still only the main instructor blocks).
- `PATCH /portal/admin/workshops/:id` (and any creation path) — `instructors` payload reshapes to `{ mainInstructorId, supportingInstructorIds: string[] }`. Backend rejects multi-main or missing-main.
- `GET` endpoints for classes / workshops (admin AND public/client read paths) — response shape gains `mainInstructorId` + `supportingInstructorIds`. For backward compatibility, also emit `instructorIds` (concatenated) so any existing fe-client code that consumed an array of IDs still works without breakage during the rollout window.

### 5.3 Services

- New `be/src/services/corporate/` folder with `packages.ts` (catalog CRUD) and `sessions.ts` (scheduling, conflict checks, cancellation). Mirrors the existing `services/classes/` / `services/workshops/` shape so admin and instructor paths cannot drift.
- Teaching-log writes (wherever existing class/workshop "session occurred" logging is) extended to emit one log entry per assigned instructor (main + supporting) with a `role` discriminator on the log row so the studio can filter. If teaching-log schema doesn't yet carry a role column, add it in this PR.

---

## 6. Portal (`fe-portal/`) changes

### 6.1 Sidebar nav (`fe-portal/src/components/layout/nav-items.ts`)

Add a 4th Packages entry, immediately under "Private Sessions":

```ts
{ group: "Packages", label: "Corporate", href: "/admin/packages/corporate", icon: Briefcase, scope: "global" },
```

Icon: `Briefcase` from lucide-react (fits the business/B2B framing). No badge.

### 6.2 New: Corporate package catalog

- `fe-portal/src/app/admin/packages/corporate/page.tsx` — list view. Table with columns: Name, Price, Status, Created. Top-right "+ New corporate package" button. Row click → edit page.
- `fe-portal/src/app/admin/packages/corporate/new/page.tsx` — create form (name / description / price). Submits to `POST /portal/admin/corporate-packages`.
- `fe-portal/src/app/admin/packages/corporate/[id]/edit/page.tsx` — edit form + archive toggle.

Visual style: copies the workshops admin pages 1:1 — same `PageHeader`, same form components, same table component. No new visual motifs (per existing design-consistency memory).

### 6.3 Schedule integration

In `fe-portal/src/app/admin/schedule/page.tsx`:

- Add a new top-right action between Workshop and PT Session: a "Corporate ▼" dropdown styled identically to the existing Workshop dropdown. Body lists active corporate packages; clicking a package navigates to `/admin/schedule/new/corporate?packageId=<id>`. Empty state: "No corporate packages configured." + link to the catalog.
- Filter pill `Type` adds option `corporate`.
- `kindClasses()` adds a new branch for `corporate`: `bg-slate/15 border-slate-deep text-slate-deep hover:bg-slate/25` (or whatever neutral token the theme exposes — to be matched to the existing palette during implementation, not invented).
- `Legend` adds a "Corporate" entry.
- `EventBlock` subtitle for kind=corporate renders `clientName · roomName` (instead of instructor list), to keep the calendar tile information-dense for the corporate use case. Hover/title attribute still shows the instructor.

New page: `fe-portal/src/app/admin/schedule/new/corporate/page.tsx` — form fields: package (locked, shown read-only from query param; link to change), main instructor, supporting instructors (multi-select), location, room (filtered by location), date, start time, end time, client name. Submits to `POST /portal/admin/corporate-sessions`.

Existing schedule detail page `fe-portal/src/app/admin/schedule/[type]/[id]/page.tsx` extends to handle `type=corporate` — shows session details, links to package, allows reschedule + cancel.

### 6.4 Existing form updates

- `fe-portal/src/app/admin/schedule/new/class/page.tsx` and the class edit surface — split instructor field into "Main instructor" (single select, required) + "Supporting instructors" (multi-select, optional). UI affordance: tag chips for supporting, with remove buttons.
- Workshop create / edit form (`fe-portal/src/app/admin/packages/workshops/.../page.tsx`) — same split. Existing M:N picker becomes Main + Supporting.

---

## 7. fe-client (`fe-client/`) changes

- **Class detail page** — render the main instructor in the existing prominent slot. Add a secondary line: "with <name> & <name>" (supporting) if the array is non-empty. Quiet styling, no separate section header.
- **Workshop detail page** — same treatment.
- **No new pages, no new routes.** Corporate is never surfaced.

Type updates to the existing class/workshop client-side types to include `mainInstructorId` + `supportingInstructorIds`. `instructorIds` (compatibility flat array from BE) can be removed once both frontends are updated in the same PR.

---

## 8. Testing

- BE unit tests for: corporate package CRUD, corporate session create with conflict matrix (room conflict / main-instructor conflict / supporting overlap allowed), main/supporting validation (rejects multi-main, rejects main-in-supporting), schedule aggregator emits corporate entries, archived package cannot back a new session.
- BE migration smoke test: backfill of `workshop_instructors.role` produces exactly one `main` per workshop on a seed dataset.
- Portal: existing patterns (no new test infra needed). Manual verification of sidebar entry, catalog CRUD, schedule "+ Corporate" flow, class/workshop form split.
- fe-client: existing detail pages render with supporting list both empty and populated.

---

## 9. Rollout

Single deploy. The schema migration, BE, fe-portal, and fe-client changes ship together to avoid intermediate states where one side knows about main/supporting and the other doesn't.

CI updates: none — no new env vars introduced. `.env.example` unchanged. `deploy-be.yml` unchanged.

---

## 10. Open questions for the user

If any of the **assumed defaults in §2 are wrong**, call them out by ID (D1–D12) on review. Otherwise the spec is ready to hand off to `writing-plans`.
