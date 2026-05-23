# Corporate Package + Main/Supporting Instructors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a portal-only "Corporate" package type and scheduling flow, and restructure classes/workshops/corporate sessions to support 1 main instructor + N supporting instructors (PT excluded).

**Architecture:** Single Drizzle migration creates two new tables (`corporate_packages`, `corporate_sessions`), adds two new supporting-instructor junctions (`class_supporting_instructors`, `corporate_session_supporting_instructors`), renames `classes.instructor_id` → `main_instructor_id`, and adds a `role` enum column to `workshop_instructors` with a partial unique index enforcing exactly one main per workshop. BE adds two new route modules under `/portal/admin/`; existing class/workshop routes accept `supportingInstructorIds`. Schedule aggregator is extended to emit `corporate` entries. Portal adds a 4th "Corporate" entry to the Packages sidebar group, a catalog page, and a "Corporate ▼" dropdown on the schedule that opens a new creation form. fe-client class/workshop detail pages render supporting instructors as a quiet secondary line.

**Tech Stack:** Hono + Drizzle ORM + Postgres on the BE; Next.js App Router + Tailwind + shadcn/ui on fe-portal and fe-client. Vitest on BE.

**Reference spec:** `docs/superpowers/specs/2026-05-23-corporate-package-and-main-supporting-instructors-design.md`. Section numbers below (e.g. §4.2) refer to that doc.

**Plan conventions:**
- Every file path is absolute from the repo root.
- "Sister-page template" means: open the named file, copy its layout/imports/components, swap labels and the API call to match the new task.
- Commit messages: no `Co-Authored-By` trailer, no "Generated with Claude" line (project convention).
- BE tests live in `be/tests/**`. Run with `npm test --prefix be`.

---

## Phase 1 — Schema & migration

### Task 1.1: Add `workshopInstructorRoleEnum`

**Files:**
- Modify: `be/src/db/enums.ts`

- [ ] **Step 1: Append the new enum to the Packages-or-Schedule section**

Edit `be/src/db/enums.ts`. Below the existing `lifecycleEnum` (around line 22), add:

```ts
// Workshop / class / corporate session instructor role (§4.3)
export const workshopInstructorRoleEnum = pgEnum('workshop_instructor_role', ['main', 'supporting'])
export type WorkshopInstructorRole = (typeof workshopInstructorRoleEnum.enumValues)[number]
```

- [ ] **Step 2: Commit**

```bash
git add be/src/db/enums.ts
git commit -m "feat(be): add workshop_instructor_role enum"
```

---

### Task 1.2: Add `corporate_packages` table

**Files:**
- Modify: `be/src/db/schema/packages.ts`

- [ ] **Step 1: Append the table to packages.ts**

At the end of `be/src/db/schema/packages.ts`, add:

```ts
// ---------- corporate_packages (admin-only catalogue, NOT visible to fe-client) ----------

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

`staffUsers` is already imported at the top of the file (line 14) — no new imports needed if `pgTable`/`uuid`/`text`/`timestamp`/`numeric`/`index`/`check`/`sql` are already in scope. Check the existing import block; add any missing ones.

- [ ] **Step 2: Re-export from `be/src/db/schema/index.ts`**

Open `be/src/db/schema/index.ts`. Find the `packages` re-export line. The file likely already re-exports all of `./packages` with `export * from './packages'` — if so, nothing to do. If it's selective, add `corporatePackages`.

- [ ] **Step 3: Type-check**

```bash
npm run typecheck --prefix be
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add be/src/db/schema/packages.ts be/src/db/schema/index.ts
git commit -m "feat(be): add corporate_packages schema"
```

---

### Task 1.3: Add `corporate_sessions` table

**Files:**
- Modify: `be/src/db/schema/schedule.ts`

- [ ] **Step 1: Add import for corporatePackages**

At the top of `be/src/db/schema/schedule.ts`, in the import block from `'./packages'` (or add a new one if none exists), import `corporatePackages`:

```ts
import { corporatePackages } from './packages'
```

- [ ] **Step 2: Append the table at the end of schedule.ts**

```ts
// ============================================================================
// corporate_sessions (NEW — portal-only, NOT visible to fe-client)
// Pure room/instructor block; no attendee roster; no credit cost; no capacity.
// ============================================================================

export const corporateSessions = pgTable(
  'corporate_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    corporatePackageId: uuid('corporate_package_id')
      .notNull()
      .references(() => corporatePackages.id, { onDelete: 'restrict' }),
    clientName: text('client_name').notNull(),
    mainInstructorId: uuid('main_instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    roomId: uuid('room_id')
      .notNull()
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

- [ ] **Step 3: Type-check + commit**

```bash
npm run typecheck --prefix be
git add be/src/db/schema/schedule.ts
git commit -m "feat(be): add corporate_sessions schema"
```

---

### Task 1.4: Add `class_supporting_instructors` junction

**Files:**
- Modify: `be/src/db/schema/schedule.ts`

- [ ] **Step 1: Append after the `classes` table**

```ts
// ============================================================================
// class_supporting_instructors (§4.3) — 0..N per class. Main lives on classes.main_instructor_id.
// ============================================================================

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

- [ ] **Step 2: Type-check + commit**

```bash
npm run typecheck --prefix be
git add be/src/db/schema/schedule.ts
git commit -m "feat(be): add class_supporting_instructors junction"
```

---

### Task 1.5: Add `corporate_session_supporting_instructors` junction

**Files:**
- Modify: `be/src/db/schema/schedule.ts`

- [ ] **Step 1: Append after `corporateSessions`**

```ts
// ============================================================================
// corporate_session_supporting_instructors (§4.3) — 0..N per session.
// ============================================================================

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

- [ ] **Step 2: Type-check + commit**

```bash
npm run typecheck --prefix be
git add be/src/db/schema/schedule.ts
git commit -m "feat(be): add corporate_session_supporting_instructors junction"
```

---

### Task 1.6: Refactor `workshop_instructors` with `role`

**Files:**
- Modify: `be/src/db/schema/schedule.ts`

- [ ] **Step 1: Import the new enum**

At the top of `schedule.ts`, in the existing enum-import line, add `workshopInstructorRoleEnum`:

```ts
import { lifecycleEnum, ptSessionTypeEnum, ptRequestStatusEnum, workshopInstructorRoleEnum } from '../enums'
```

- [ ] **Step 2: Replace the existing `workshopInstructors` table**

Find the current definition (M:N with just `workshopId` + `instructorId`). Replace its body with:

```ts
export const workshopInstructors = pgTable(
  'workshop_instructors',
  {
    workshopId: uuid('workshop_id')
      .notNull()
      .references(() => workshops.id, { onDelete: 'cascade' }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'cascade' }),
    role: workshopInstructorRoleEnum('role').notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.workshopId, table.instructorId] }),
    mainUnique: uniqueIndex('workshop_instructors_main_unique')
      .on(table.workshopId)
      .where(sql`role = 'main'`),
    workshopRoleIdx: index('workshop_instructors_workshop_role_idx').on(table.workshopId, table.role),
  }),
)
```

- [ ] **Step 3: Type-check + commit**

```bash
npm run typecheck --prefix be
git add be/src/db/schema/schedule.ts
git commit -m "feat(be): add role column to workshop_instructors"
```

---

### Task 1.7: Rename `classes.instructor_id` → `main_instructor_id`

**Files:**
- Modify: `be/src/db/schema/schedule.ts`

- [ ] **Step 1: Rename the column in the `classes` table**

In the `classes` pgTable definition, change:

```ts
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'restrict' }),
```

to:

```ts
    mainInstructorId: uuid('main_instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'restrict' }),
```

- [ ] **Step 2: Rename the index**

In the same table's `extras` block, change:

```ts
    instructorStartsIdx: index('classes_instructor_starts_idx').on(table.instructorId, table.startsAt),
```

to:

```ts
    mainInstructorStartsIdx: index('classes_main_instructor_starts_idx').on(table.mainInstructorId, table.startsAt),
```

- [ ] **Step 3: Fix all TS references to the old column name**

Run a grep to locate every consumer:

```bash
grep -rn "instructorId" be/src --include="*.ts" | grep -i "classes" | grep -v "node_modules"
```

For each match in `be/src/services/**`, `be/src/routes/**`, `be/src/db/queries/**`: rename `instructorId` → `mainInstructorId` ONLY when the access is on a `classes` row (do NOT touch instructor accesses on workshops, ptSessions, etc.). Also fix any SQL string references to `instructor_id` that target the classes table.

- [ ] **Step 4: Type-check repeatedly until clean**

```bash
npm run typecheck --prefix be
```

Fix any remaining errors by renaming references. Expected end state: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src
git commit -m "refactor(be): rename classes.instructor_id to main_instructor_id"
```

---

### Task 1.8: Generate Drizzle migration

**Files:**
- Create: `be/drizzle/<next-numbered>_corporate_and_main_supporting.sql` (drizzle-kit generates the name)

- [ ] **Step 1: Run drizzle-kit generate**

```bash
npm run db:generate --prefix be
```

This creates a new SQL migration file under `be/drizzle/`. Open it and review.

- [ ] **Step 2: Verify the generated SQL contains all expected operations**

The file should contain (in some order):
- `CREATE TYPE workshop_instructor_role AS ENUM ('main', 'supporting');`
- `CREATE TABLE corporate_packages (...);` with all indexes + the price check.
- `CREATE TABLE corporate_sessions (...);` with all indexes + the time check.
- `CREATE TABLE class_supporting_instructors (...);`
- `CREATE TABLE corporate_session_supporting_instructors (...);`
- `ALTER TABLE classes RENAME COLUMN instructor_id TO main_instructor_id;`
- Index rename for the classes index.
- `ALTER TABLE workshop_instructors ADD COLUMN role workshop_instructor_role;` (initially nullable per drizzle-kit default).
- The unique-on-main index.

If drizzle-kit emits a destructive `DROP TABLE workshop_instructors` + `CREATE TABLE` instead of an `ALTER ... ADD COLUMN`, manually rewrite to use `ALTER` to preserve existing rows.

- [ ] **Step 3: Stop. Do NOT commit yet — Task 1.9 hand-edits this file.**

---

### Task 1.9: Hand-edit migration for `workshop_instructors.role` backfill

**Files:**
- Modify: the migration SQL file generated in Task 1.8.

- [ ] **Step 1: Insert backfill SQL**

Locate the `ALTER TABLE workshop_instructors ADD COLUMN role ...` line in the migration. Immediately after it (before the `NOT NULL` constraint is set, before the unique index is created), insert:

```sql
-- Backfill: deterministically choose one 'main' per workshop.
-- For each workshop_id, the row with the lexicographically smallest instructor_id::text
-- becomes 'main'; the rest become 'supporting'.
WITH ranked AS (
  SELECT
    workshop_id,
    instructor_id,
    ROW_NUMBER() OVER (
      PARTITION BY workshop_id
      ORDER BY instructor_id::text
    ) AS rn
  FROM workshop_instructors
)
UPDATE workshop_instructors AS wi
SET role = CASE WHEN r.rn = 1 THEN 'main'::workshop_instructor_role
                ELSE 'supporting'::workshop_instructor_role
           END
FROM ranked r
WHERE wi.workshop_id = r.workshop_id
  AND wi.instructor_id = r.instructor_id;
```

- [ ] **Step 2: Ensure the `SET NOT NULL` runs AFTER the backfill**

The next statement should be:

```sql
ALTER TABLE workshop_instructors ALTER COLUMN role SET NOT NULL;
```

If drizzle-kit placed `NOT NULL` in the original `ADD COLUMN` line, change it to a separate `SET NOT NULL` that follows the backfill UPDATE.

- [ ] **Step 3: Ensure the unique-on-main index is created AFTER the backfill**

The `CREATE UNIQUE INDEX workshop_instructors_main_unique ...` statement must come after the backfill UPDATE.

- [ ] **Step 4: Commit**

```bash
git add be/drizzle
git commit -m "feat(be): migration for corporate tables + main/supporting refactor"
```

---

### Task 1.10: Run migration locally and verify

- [ ] **Step 1: Apply the migration**

```bash
npm run db:migrate --prefix be
```

Expected: completes without error.

- [ ] **Step 2: Smoke-check the DB shape**

Connect to your local Postgres (psql or any client) and run:

```sql
\d corporate_packages
\d corporate_sessions
\d class_supporting_instructors
\d corporate_session_supporting_instructors
\d workshop_instructors
\d classes
```

Verify: `classes.main_instructor_id` exists; `classes.instructor_id` does NOT exist; `workshop_instructors.role` is NOT NULL; the unique-on-main partial index is present.

- [ ] **Step 3: Verify backfill on existing data**

```sql
SELECT workshop_id, COUNT(*) FILTER (WHERE role = 'main') AS main_count
FROM workshop_instructors
GROUP BY workshop_id
HAVING COUNT(*) FILTER (WHERE role = 'main') <> 1;
```

Expected: zero rows.

- [ ] **Step 4: No code changes in this task — nothing to commit.**

---

## Phase 2 — Corporate package CRUD (BE)

### Task 2.1: Service layer for corporate packages

**Files:**
- Create: `be/src/services/packages/corporate-packages.ts`
- Test: `be/tests/services/packages/corporate-packages.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `be/tests/services/packages/corporate-packages.test.ts`. Sister-template: `be/tests/services/packages/class-packages.test.ts` (if it exists; otherwise mirror the closest existing service test, e.g. `pt-packages.test.ts`).

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { resetTestDb, withTestDb, makeStaff } from '../../helpers/db'
import {
  listCorporatePackages,
  createCorporatePackage,
  getCorporatePackage,
  updateCorporatePackage,
  archiveCorporatePackage,
  deleteCorporatePackage,
} from '../../../src/services/packages/corporate-packages'

describe('corporate-packages service', () => {
  beforeEach(async () => { await resetTestDb() })

  it('creates a corporate package and lists it', async () => {
    await withTestDb(async (db) => {
      const staff = await makeStaff(db)
      const created = await createCorporatePackage(db, {
        name: 'Corporate 60min Vinyasa',
        description: 'On-site team yoga',
        priceSgd: '400.00',
        createdByStaffId: staff.id,
      })
      expect(created.id).toBeTruthy()
      expect(created.status).toBe('active')

      const all = await listCorporatePackages(db, {})
      expect(all.find(p => p.id === created.id)).toBeDefined()
    })
  })

  it('archives a package and excludes it from active-only list', async () => {
    await withTestDb(async (db) => {
      const staff = await makeStaff(db)
      const p = await createCorporatePackage(db, {
        name: 'Test', description: null, priceSgd: '300.00', createdByStaffId: staff.id,
      })
      await archiveCorporatePackage(db, p.id)
      const active = await listCorporatePackages(db, { status: 'active' })
      expect(active.find(x => x.id === p.id)).toBeUndefined()
      const all = await listCorporatePackages(db, {})
      expect(all.find(x => x.id === p.id)?.status).toBe('archived')
    })
  })

  it('rejects deleting a package that has at least one corporate_session referencing it', async () => {
    // Skip: tested in corporate-sessions.test.ts once that table is populated.
    // This test stub documents that delete returns 409 when the row is in use;
    // assertion implemented in Phase 7 test file.
  })

  it('updates name/description/price on an active package', async () => {
    await withTestDb(async (db) => {
      const staff = await makeStaff(db)
      const p = await createCorporatePackage(db, {
        name: 'Old', description: 'x', priceSgd: '100.00', createdByStaffId: staff.id,
      })
      const updated = await updateCorporatePackage(db, p.id, {
        name: 'New', description: 'y', priceSgd: '150.00',
      })
      expect(updated.name).toBe('New')
      expect(updated.priceSgd).toBe('150.00')
    })
  })
})
```

If the existing test infra does not provide `makeStaff` / `withTestDb`, mirror exactly what the closest existing service test in `be/tests/services/packages/` does for its setup.

- [ ] **Step 2: Run the test — expect failure**

```bash
npm test --prefix be -- corporate-packages.test
```

Expected: FAIL with "Cannot find module 'corporate-packages'".

- [ ] **Step 3: Implement the service**

Create `be/src/services/packages/corporate-packages.ts`:

```ts
import { and, eq, desc } from 'drizzle-orm'
import type { Db } from '../../db/types'
import { corporatePackages } from '../../db/schema/packages'
import { corporateSessions } from '../../db/schema/schedule'

export interface CreateCorporatePackageInput {
  name: string
  description: string | null
  priceSgd: string  // numeric — string-encoded
  createdByStaffId: string
}

export interface UpdateCorporatePackageInput {
  name?: string
  description?: string | null
  priceSgd?: string
}

export async function listCorporatePackages(
  db: Db,
  opts: { status?: 'active' | 'archived' },
) {
  const where = opts.status ? eq(corporatePackages.status, opts.status) : undefined
  return db.select().from(corporatePackages).where(where).orderBy(desc(corporatePackages.createdAt))
}

export async function getCorporatePackage(db: Db, id: string) {
  const [row] = await db.select().from(corporatePackages).where(eq(corporatePackages.id, id)).limit(1)
  return row ?? null
}

export async function createCorporatePackage(db: Db, input: CreateCorporatePackageInput) {
  const [row] = await db
    .insert(corporatePackages)
    .values({
      name: input.name,
      description: input.description,
      priceSgd: input.priceSgd,
      createdByStaffId: input.createdByStaffId,
    })
    .returning()
  return row
}

export async function updateCorporatePackage(db: Db, id: string, input: UpdateCorporatePackageInput) {
  const [row] = await db
    .update(corporatePackages)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priceSgd !== undefined ? { priceSgd: input.priceSgd } : {}),
    })
    .where(eq(corporatePackages.id, id))
    .returning()
  return row ?? null
}

export async function archiveCorporatePackage(db: Db, id: string) {
  const [row] = await db
    .update(corporatePackages)
    .set({ status: 'archived', archivedAt: new Date() })
    .where(eq(corporatePackages.id, id))
    .returning()
  return row ?? null
}

export async function unarchiveCorporatePackage(db: Db, id: string) {
  const [row] = await db
    .update(corporatePackages)
    .set({ status: 'active', archivedAt: null })
    .where(eq(corporatePackages.id, id))
    .returning()
  return row ?? null
}

export async function deleteCorporatePackage(db: Db, id: string): Promise<'ok' | 'in_use'> {
  const [inUse] = await db
    .select({ id: corporateSessions.id })
    .from(corporateSessions)
    .where(eq(corporateSessions.corporatePackageId, id))
    .limit(1)
  if (inUse) return 'in_use'
  await db.delete(corporatePackages).where(eq(corporatePackages.id, id))
  return 'ok'
}
```

If the `Db` type import path differs, match the pattern used by `class-packages.ts` (look at its import block).

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test --prefix be -- corporate-packages.test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/services/packages/corporate-packages.ts be/tests/services/packages/corporate-packages.test.ts
git commit -m "feat(be): corporate-packages service"
```

---

### Task 2.2: Route layer for corporate packages

**Files:**
- Create: `be/src/routes/portal/admin/corporate-packages.ts`
- Test: `be/tests/routes/portal/admin/corporate-packages.test.ts`

- [ ] **Step 1: Write the failing route test**

Sister-template: `be/tests/routes/portal/admin/class-packages.test.ts` (look at how it bootstraps the Hono app + Clerk auth stub). Mirror its structure.

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { buildTestApp, authedAs } from '../../../helpers/app'
import { resetTestDb } from '../../../helpers/db'

describe('POST /portal/admin/corporate-packages', () => {
  beforeEach(async () => { await resetTestDb() })

  it('creates a package as admin', async () => {
    const app = await buildTestApp()
    const res = await app.request('/portal/admin/corporate-packages', {
      method: 'POST',
      headers: authedAs('admin'),
      body: JSON.stringify({ name: 'Corp 60', description: null, priceSgd: '400.00' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.corporatePackage.name).toBe('Corp 60')
  })

  it('rejects unauthenticated', async () => {
    const app = await buildTestApp()
    const res = await app.request('/portal/admin/corporate-packages', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('rejects non-admin staff (instructor role)', async () => {
    const app = await buildTestApp()
    const res = await app.request('/portal/admin/corporate-packages', {
      method: 'POST',
      headers: authedAs('instructor'),
      body: JSON.stringify({ name: 'x', priceSgd: '1.00' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 409 when deleting an in-use package', async () => {
    // Implemented in Phase 7 once corporate sessions can be created.
  })
})

describe('GET/PATCH/DELETE /portal/admin/corporate-packages', () => {
  // Add coverage parallel to the class-packages test file for list/get/patch/archive.
})
```

- [ ] **Step 2: Run — expect fail**

```bash
npm test --prefix be -- corporate-packages
```

Expected: FAIL ("Cannot find module" for the route, or 404 because the route isn't mounted).

- [ ] **Step 3: Implement the route**

Sister-template for shape: `be/src/routes/portal/admin/class-packages.ts`. Create `be/src/routes/portal/admin/corporate-packages.ts`:

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { AdminEnv } from '../../../types/hono-env'
import {
  listCorporatePackages,
  createCorporatePackage,
  getCorporatePackage,
  updateCorporatePackage,
  archiveCorporatePackage,
  unarchiveCorporatePackage,
  deleteCorporatePackage,
} from '../../../services/packages/corporate-packages'

const priceSchema = z.string().regex(/^\d+(\.\d{1,2})?$/, 'must be a numeric string with up to 2 decimal places')

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  priceSgd: priceSchema,
})

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  priceSgd: priceSchema.optional(),
  status: z.enum(['active', 'archived']).optional(),
})

export const corporatePackagesRoutes = new Hono<AdminEnv>()

corporatePackagesRoutes.get('/', async (c) => {
  const db = c.get('db')
  const status = c.req.query('status') as 'active' | 'archived' | undefined
  const rows = await listCorporatePackages(db, { status })
  return c.json({ corporatePackages: rows })
})

corporatePackagesRoutes.post('/', zValidator('json', createSchema), async (c) => {
  const db = c.get('db')
  const staff = c.get('staffUser')
  const input = c.req.valid('json')
  const row = await createCorporatePackage(db, {
    name: input.name,
    description: input.description ?? null,
    priceSgd: input.priceSgd,
    createdByStaffId: staff.id,
  })
  return c.json({ corporatePackage: row }, 201)
})

corporatePackagesRoutes.get('/:id', async (c) => {
  const db = c.get('db')
  const row = await getCorporatePackage(db, c.req.param('id'))
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json({ corporatePackage: row })
})

corporatePackagesRoutes.patch('/:id', zValidator('json', patchSchema), async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const input = c.req.valid('json')

  // Handle status toggle separately to set archivedAt.
  if (input.status === 'archived') {
    const row = await archiveCorporatePackage(db, id)
    if (!row) return c.json({ error: 'not_found' }, 404)
    // fall through to apply other fields if provided
  } else if (input.status === 'active') {
    const row = await unarchiveCorporatePackage(db, id)
    if (!row) return c.json({ error: 'not_found' }, 404)
  }

  const row = await updateCorporatePackage(db, id, {
    name: input.name,
    description: input.description,
    priceSgd: input.priceSgd,
  })
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json({ corporatePackage: row })
})

corporatePackagesRoutes.delete('/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const outcome = await deleteCorporatePackage(db, id)
  if (outcome === 'in_use') return c.json({ error: 'in_use' }, 409)
  return c.json({ ok: true })
})
```

If the project's existing pattern uses a different validator import (`@hono/zod-validator` vs an in-house wrapper), match the existing class-packages route exactly.

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test --prefix be -- corporate-packages
```

Expected: PASS (the 409-in-use test is currently a no-op stub).

- [ ] **Step 5: Commit**

```bash
git add be/src/routes/portal/admin/corporate-packages.ts be/tests/routes/portal/admin/corporate-packages.test.ts
git commit -m "feat(be): corporate-packages routes"
```

---

### Task 2.3: Wire the route into the admin router

**Files:**
- Modify: `be/src/routes/portal/admin/index.ts`

- [ ] **Step 1: Add import + mount**

Open `be/src/routes/portal/admin/index.ts`. Add to the import block:

```ts
import { corporatePackagesRoutes } from './corporate-packages'
```

Then mount alongside the other route modules (look for where `classPackagesRoutes` or `ptPackagesRoutes` is mounted, add a sibling line):

```ts
adminRouter.route('/corporate-packages', corporatePackagesRoutes)
```

- [ ] **Step 2: Run the route tests end-to-end**

```bash
npm test --prefix be -- corporate-packages
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add be/src/routes/portal/admin/index.ts
git commit -m "feat(be): mount corporate-packages router"
```

---

## Phase 3 — Portal corporate package catalog

### Task 3.1: Add the "Corporate" sidebar nav item

**Files:**
- Modify: `fe-portal/src/components/layout/nav-items.ts`

- [ ] **Step 1: Add Briefcase to the lucide imports**

In the import block at the top, add `Briefcase`:

```ts
import {
  Tag, DoorOpen, Shield, Layers, Heart, Sparkles, CalendarDays, QrCode,
  HandHeart, Users, Mail, FileText, UserCog, Briefcase,
} from "lucide-react";
```

- [ ] **Step 2: Insert the nav item under Private Sessions**

Locate the line `{ group: "Packages", label: "Private Sessions", ... }` (around line 53). Insert immediately after it:

```ts
  { group: "Packages", label: "Corporate", href: "/admin/packages/corporate", icon: Briefcase, scope: "global" },
```

- [ ] **Step 3: Manual smoke-check**

```bash
npm run typecheck --prefix fe-portal
```

Expected: PASS. (Running the dev server is optional but recommended to eyeball the sidebar.)

- [ ] **Step 4: Commit**

```bash
git add fe-portal/src/components/layout/nav-items.ts
git commit -m "feat(fe-portal): add Corporate sidebar nav item"
```

---

### Task 3.2: Corporate catalog list page

**Files:**
- Create: `fe-portal/src/app/admin/packages/corporate/page.tsx`

- [ ] **Step 1: Identify the sister-page template**

Open `fe-portal/src/app/admin/packages/workshops/page.tsx`. This is the closest existing list-with-table-and-create-button layout in the Packages group. Read its full content to understand the imports, `PageHeader`, table component, status-pill rendering, and API call pattern.

- [ ] **Step 2: Create the new list page mirroring that template**

Create `fe-portal/src/app/admin/packages/corporate/page.tsx`. Replace these in the template you read:

| In workshops template | Replace with |
|---|---|
| Title "Workshops" | "Corporate Packages" |
| API endpoint `/portal/admin/workshops` | `/portal/admin/corporate-packages` |
| Response key `workshops` | `corporatePackages` |
| Table columns: Name / Location / Status / Lifecycle | Name / Price / Status / Created |
| Row link `/admin/packages/workshops/[id]/edit` | `/admin/packages/corporate/[id]/edit` |
| "New workshop" button label and href `/admin/packages/workshops/new` | "New corporate package" / `/admin/packages/corporate/new` |

The price column should format as `S$<priceSgd>` (use the existing `formatCurrency` helper from `fe-portal/src/lib/formatters.ts` if one exists; otherwise inline `S$${priceSgd}`). The Created column uses the existing `formatDate` helper applied to `createdAt`.

- [ ] **Step 3: Typecheck + build**

```bash
npm run typecheck --prefix fe-portal
npx --prefix fe-portal next build
```

Expected: PASS. (Build catches missing-page issues that typecheck misses.)

- [ ] **Step 4: Commit**

```bash
git add fe-portal/src/app/admin/packages/corporate/page.tsx
git commit -m "feat(fe-portal): corporate packages list page"
```

---

### Task 3.3: Corporate catalog "New" page

**Files:**
- Create: `fe-portal/src/app/admin/packages/corporate/new/page.tsx`

- [ ] **Step 1: Sister-template**

Open `fe-portal/src/app/admin/packages/workshops/new/page.tsx`.

- [ ] **Step 2: Create the new page**

Mirror the template, but the form has only THREE fields: `name`, `description` (optional), `priceSgd` (numeric input, 2 decimal places). On submit, POST to `/portal/admin/corporate-packages` with `{ name, description, priceSgd }`. On success, `router.push('/admin/packages/corporate')`.

No location picker. No tier editor. No image uploader. No instructor multi-select. Single-screen form, ~80 lines of TSX.

Example body skeleton:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, PageHeader, Textarea } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";

export default function NewCorporatePackagePage() {
  const router = useRouter();
  const { api } = useWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceSgd, setPriceSgd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/portal/admin/corporate-packages", {
        name,
        description: description || null,
        priceSgd,
      });
      router.push("/admin/packages/corporate");
    } catch (err: any) {
      setError(err?.message ?? "Failed to create");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title="New corporate package" description="Configure a B2B offering. Not visible to members." />
      <form onSubmit={onSubmit} className="max-w-xl space-y-4 rounded-xl border border-border bg-card p-6 shadow-soft">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </div>
        <div>
          <Label htmlFor="price">Price (SGD)</Label>
          <Input id="price" type="number" step="0.01" min="0" value={priceSgd}
            onChange={(e) => setPriceSgd(e.target.value)} required />
        </div>
        {error && <p className="text-sm text-error">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create"}</Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
```

If `useWorkspace()` does not expose `api`, look at workshops/new/page.tsx for the correct way to obtain the HTTP client and substitute.

- [ ] **Step 3: Typecheck + build + commit**

```bash
npm run typecheck --prefix fe-portal
npx --prefix fe-portal next build
git add fe-portal/src/app/admin/packages/corporate/new/page.tsx
git commit -m "feat(fe-portal): corporate packages create page"
```

---

### Task 3.4: Corporate catalog edit page

**Files:**
- Create: `fe-portal/src/app/admin/packages/corporate/[id]/edit/page.tsx`

- [ ] **Step 1: Sister-template**

`fe-portal/src/app/admin/packages/workshops/[id]/edit/page.tsx` is much larger than the corporate edit page will need, but the basic data-fetch + form pattern is the same. Read just the top section that fetches the record by `id`.

- [ ] **Step 2: Build the edit page**

Same three fields as the New page. Plus an "Archive" / "Unarchive" button that calls `PATCH /portal/admin/corporate-packages/:id` with `{ status: 'archived' | 'active' }`. Plus a "Delete" button that calls `DELETE /portal/admin/corporate-packages/:id` and shows a toast for `409 in_use`.

Form layout — copy the New page's skeleton, replace `useState("")` with `useState(loadedValue)` after the fetch resolves. The fetch:

```tsx
useEffect(() => {
  if (!api) return;
  let cancelled = false;
  void (async () => {
    const data = await api.get<{ corporatePackage: any }>(`/portal/admin/corporate-packages/${id}`);
    if (cancelled) return;
    setName(data.corporatePackage.name);
    setDescription(data.corporatePackage.description ?? "");
    setPriceSgd(data.corporatePackage.priceSgd);
    setStatus(data.corporatePackage.status);
  })();
  return () => { cancelled = true; };
}, [api, id]);
```

On submit: `PATCH` the same payload as create.

- [ ] **Step 3: Typecheck + build + commit**

```bash
npm run typecheck --prefix fe-portal
npx --prefix fe-portal next build
git add fe-portal/src/app/admin/packages/corporate/[id]/edit/page.tsx
git commit -m "feat(fe-portal): corporate packages edit page"
```

---

## Phase 4 — Main/supporting in class & workshop CRUD (BE)

### Task 4.1: Update class create/update services to accept supporting instructors

**Files:**
- Modify: `be/src/services/schedule/classes.ts`
- Test: `be/tests/services/schedule/classes.test.ts` (if missing, create alongside)

- [ ] **Step 1: Write failing tests for the new behavior**

Add cases to (or create) `be/tests/services/schedule/classes.test.ts`:

```ts
it('writes supporting instructors junction on create', async () => {
  await withTestDb(async (db) => {
    const { staff, instructorMain, instructorSup1, instructorSup2, classType, location } = await seedClassDeps(db)
    const cls = await createClass(db, {
      classTypeId: classType.id,
      mainInstructorId: instructorMain.staffUserId,
      supportingInstructorIds: [instructorSup1.staffUserId, instructorSup2.staffUserId],
      locationId: location.id,
      roomId: null,
      startsAt: new Date('2026-06-01T10:00:00Z'),
      endsAt: new Date('2026-06-01T11:00:00Z'),
      capacityOnline: 10, capacityWaitlist: 0, capacityBuffer: 0,
      creditCost: 1,
      createdByStaffId: staff.id,
    })
    const supports = await db.select().from(classSupportingInstructors).where(eq(classSupportingInstructors.classId, cls.id))
    expect(supports.map(s => s.instructorId).sort()).toEqual([instructorSup1.staffUserId, instructorSup2.staffUserId].sort())
  })
})

it('rejects when main is also in supporting list', async () => {
  await withTestDb(async (db) => {
    const { staff, instructorMain, classType, location } = await seedClassDeps(db)
    await expect(createClass(db, {
      classTypeId: classType.id,
      mainInstructorId: instructorMain.staffUserId,
      supportingInstructorIds: [instructorMain.staffUserId],
      locationId: location.id,
      roomId: null,
      startsAt: new Date('2026-06-01T10:00:00Z'),
      endsAt: new Date('2026-06-01T11:00:00Z'),
      capacityOnline: 10, capacityWaitlist: 0, capacityBuffer: 0,
      creditCost: 1,
      createdByStaffId: staff.id,
    })).rejects.toThrowError(/main.*supporting/i)
  })
})

it('updates supporting list on update (replaces, does not append)', async () => {
  // Setup: class with two supports; update sends one different support; verify final set is exactly the updated one.
})
```

Implement `seedClassDeps` if not present (mirror the seed helper from any existing schedule test).

- [ ] **Step 2: Run — expect fail**

```bash
npm test --prefix be -- classes.test
```

Expected: FAIL.

- [ ] **Step 3: Update the service**

In `be/src/services/schedule/classes.ts`, modify the create + update signatures to accept `supportingInstructorIds: string[]` and write the junction in the same transaction.

```ts
export interface CreateClassInput {
  // ... existing fields, BUT:
  mainInstructorId: string  // RENAMED from instructorId
  supportingInstructorIds: string[]
  // ... rest unchanged
}

export async function createClass(db: Db, input: CreateClassInput) {
  if (input.supportingInstructorIds.includes(input.mainInstructorId)) {
    throw new Error('main instructor cannot also appear in supportingInstructorIds')
  }
  // de-dupe (defensive)
  const supports = Array.from(new Set(input.supportingInstructorIds))

  return await db.transaction(async (tx) => {
    const [cls] = await tx.insert(classes).values({
      classTypeId: input.classTypeId,
      mainInstructorId: input.mainInstructorId,
      locationId: input.locationId,
      roomId: input.roomId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      capacityOnline: input.capacityOnline,
      capacityWaitlist: input.capacityWaitlist,
      capacityBuffer: input.capacityBuffer,
      creditCost: input.creditCost,
      createdByStaffId: input.createdByStaffId,
    }).returning()

    if (supports.length > 0) {
      await tx.insert(classSupportingInstructors).values(
        supports.map((instructorId) => ({ classId: cls.id, instructorId })),
      )
    }
    return cls
  })
}
```

Update `updateClass` similarly: on update, if `supportingInstructorIds` is provided in the patch, delete-then-reinsert the junction inside a transaction.

- [ ] **Step 4: Run — expect pass**

```bash
npm test --prefix be -- classes.test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/services/schedule/classes.ts be/tests/services/schedule/classes.test.ts
git commit -m "feat(be): classes service accepts supporting instructors"
```

---

### Task 4.2: Update class admin routes to accept + emit supporting instructors

**Files:**
- Modify: `be/src/routes/portal/admin/schedule.ts` OR `be/src/routes/portal/admin/classes.ts` — locate whichever currently defines `POST /classes` and `PATCH /classes/:id`.

- [ ] **Step 1: Locate the route file**

```bash
grep -rn "admin/classes" be/src/routes --include="*.ts"
```

The actual handler may live inside the `schedule.ts` router (since classes are a schedule entity) or as its own module. Open whichever file declares the handler.

- [ ] **Step 2: Update the Zod schema for create**

Find the existing create schema. Rename `instructorId` → `mainInstructorId` and add `supportingInstructorIds`:

```ts
const createClassSchema = z.object({
  classTypeId: z.string().uuid(),
  mainInstructorId: z.string().uuid(),
  supportingInstructorIds: z.array(z.string().uuid()).default([]),
  locationId: z.string().uuid(),
  roomId: z.string().uuid().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  capacityOnline: z.number().int().min(0),
  capacityWaitlist: z.number().int().min(0),
  capacityBuffer: z.number().int().min(0),
  creditCost: z.number().int().min(0),
})
```

- [ ] **Step 3: Update the PATCH schema similarly**

```ts
const patchClassSchema = createClassSchema.partial()
```

- [ ] **Step 4: Update GET responses to hydrate supporting instructors**

In the read handler (single + list), join `class_supporting_instructors` and emit:

```ts
{
  // ... existing fields
  mainInstructorId,
  supportingInstructorIds: string[],  // sorted by instructor name for stable rendering
  instructorIds: string[],            // [main, ...supporting] for back-compat
}
```

- [ ] **Step 5: Run the existing class route tests + add a new one**

Add to the route test file:

```ts
it('round-trips supporting instructors through POST + GET', async () => {
  const app = await buildTestApp()
  const ids = await seedTwoInstructors()
  const create = await app.request('/portal/admin/classes', {
    method: 'POST', headers: authedAs('admin'),
    body: JSON.stringify({ /* ... */ mainInstructorId: ids[0], supportingInstructorIds: [ids[1]] }),
  })
  expect(create.status).toBe(201)
  const { class: cls } = await create.json()
  expect(cls.mainInstructorId).toBe(ids[0])
  expect(cls.supportingInstructorIds).toEqual([ids[1]])
})
```

Run:

```bash
npm test --prefix be -- classes
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add be/src/routes/portal/admin/
git commit -m "feat(be): class routes accept/emit main+supporting instructors"
```

---

### Task 4.3: Update workshop service for main/supporting

**Files:**
- Modify: `be/src/services/workshops/catalog.ts` (or whichever service holds workshop create/update)
- Modify: `be/src/services/workshops/publish.ts` if it touches the instructor junction
- Test: `be/tests/services/workshops/*.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the existing workshop service test (or create one):

```ts
it('requires exactly one main instructor on create', async () => {
  await withTestDb(async (db) => {
    const { staff, instructors, location } = await seedWorkshopDeps(db, 3)
    // No main provided → reject
    await expect(createWorkshop(db, {
      name: 'W', locationId: location.id,
      mainInstructorId: null as any,
      supportingInstructorIds: [instructors[0].staffUserId],
      createdByStaffId: staff.id,
    })).rejects.toThrow()
  })
})

it('main row carries role=main, supporting rows carry role=supporting', async () => {
  await withTestDb(async (db) => {
    const { staff, instructors, location } = await seedWorkshopDeps(db, 3)
    const w = await createWorkshop(db, {
      name: 'W', locationId: location.id,
      mainInstructorId: instructors[0].staffUserId,
      supportingInstructorIds: [instructors[1].staffUserId, instructors[2].staffUserId],
      createdByStaffId: staff.id,
    })
    const rows = await db.select().from(workshopInstructors).where(eq(workshopInstructors.workshopId, w.id))
    const main = rows.filter(r => r.role === 'main')
    const sup = rows.filter(r => r.role === 'supporting')
    expect(main).toHaveLength(1)
    expect(main[0].instructorId).toBe(instructors[0].staffUserId)
    expect(sup.map(r => r.instructorId).sort()).toEqual([instructors[1].staffUserId, instructors[2].staffUserId].sort())
  })
})
```

- [ ] **Step 2: Run — expect fail**

```bash
npm test --prefix be -- workshops
```

- [ ] **Step 3: Update the create/update service**

Modify the workshop create/update flow. The previous code likely accepted `instructorIds: string[]`. Replace with:

```ts
export interface CreateWorkshopInput {
  name: string
  locationId: string
  mainInstructorId: string
  supportingInstructorIds: string[]
  // ... other fields
  createdByStaffId: string
}

export async function createWorkshop(db: Db, input: CreateWorkshopInput) {
  if (!input.mainInstructorId) {
    throw new Error('mainInstructorId is required')
  }
  if (input.supportingInstructorIds.includes(input.mainInstructorId)) {
    throw new Error('main instructor cannot also appear in supportingInstructorIds')
  }
  const supports = Array.from(new Set(input.supportingInstructorIds))

  return await db.transaction(async (tx) => {
    const [w] = await tx.insert(workshops).values({
      name: input.name,
      locationId: input.locationId,
      createdByStaffId: input.createdByStaffId,
    }).returning()

    await tx.insert(workshopInstructors).values([
      { workshopId: w.id, instructorId: input.mainInstructorId, role: 'main' as const },
      ...supports.map((id) => ({ workshopId: w.id, instructorId: id, role: 'supporting' as const })),
    ])
    return w
  })
}
```

For update: when `mainInstructorId` and/or `supportingInstructorIds` are in the patch, replace the entire `workshopInstructors` rowset for that workshop atomically.

- [ ] **Step 4: Run — expect pass + commit**

```bash
npm test --prefix be -- workshops
git add be/src/services/workshops be/tests/services/workshops
git commit -m "feat(be): workshops service main+supporting roles"
```

---

### Task 4.4: Update workshop admin routes

**Files:**
- Modify: `be/src/routes/portal/admin/workshops.ts`

- [ ] **Step 1: Update Zod schemas**

Replace any `instructorIds: z.array(z.string().uuid())` with:

```ts
mainInstructorId: z.string().uuid(),
supportingInstructorIds: z.array(z.string().uuid()).default([]),
```

For PATCH, use `.partial()` semantics.

- [ ] **Step 2: Update GET shape**

When loading a workshop, hydrate the junction split by role:

```ts
{
  // ... existing fields
  mainInstructorId: string,
  supportingInstructorIds: string[],
  instructorIds: string[],  // [main, ...supporting] for back-compat with any consumer
}
```

- [ ] **Step 3: Add a route-level round-trip test**

```ts
it('round-trips main + supporting through POST + GET', async () => { /* mirror class round-trip test */ })
```

- [ ] **Step 4: Run + commit**

```bash
npm test --prefix be -- workshops
git add be/src/routes/portal/admin/workshops.ts be/tests/routes/portal/admin/workshops.test.ts
git commit -m "feat(be): workshop routes accept/emit main+supporting instructors"
```

---

### Task 4.5: Update public/client read responses

**Files:**
- Modify: `be/src/routes/public/**` and/or `be/src/routes/client/**` — any handler that returns class or workshop instructor info to fe-client.

- [ ] **Step 1: Locate all client/public class+workshop readers**

```bash
grep -rn "instructorId\|instructors:" be/src/routes/public be/src/routes/client --include="*.ts"
```

- [ ] **Step 2: For each, replace the response shape**

Each affected handler must now emit:

```ts
{
  mainInstructorId,
  supportingInstructorIds,
  // For backward compatibility during deploy:
  instructorIds: [mainInstructorId, ...supportingInstructorIds],
}
```

When loading workshop instructors, query workshopInstructors and split by role. When loading class instructors, the main is on `classes.main_instructor_id`; supporting via `class_supporting_instructors`.

- [ ] **Step 3: Run all be tests to catch regressions**

```bash
npm test --prefix be
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add be/src/routes
git commit -m "feat(be): public/client readers emit main + supporting instructors"
```

---

### Task 4.6: Teaching log writes for main + supporting

**Files:**
- Locate the existing teaching-log writer. Run:

```bash
grep -rn "teaching_log\|teachingLog" be/src --include="*.ts"
```

- [ ] **Step 1: If a teaching-log writer exists, expand it**

Find where a class/workshop "occurred" event writes a log row (likely in a check-in flow or a class-completion service). Currently it writes one row per main instructor. Change it to:

```ts
const instructorIds = [cls.mainInstructorId, ...supportingInstructorIds]
for (const instructorId of instructorIds) {
  await tx.insert(teachingLog).values({
    classId: cls.id,
    instructorId,
    role: instructorId === cls.mainInstructorId ? 'main' : 'supporting',
    // ... other existing fields
  })
}
```

- [ ] **Step 2: Add `role` column to `teaching_log` if it doesn't exist**

If the existing teaching_log schema has no `role` column, add one in this PR. Edit `be/src/db/schema/ops.ts` (or wherever teaching_log lives), append:

```ts
role: workshopInstructorRoleEnum('role').notNull().default('main'),
```

Then re-run `npm run db:generate --prefix be` to regenerate the migration. Append the new column DDL to the existing Phase-1 migration file (do NOT create a second migration file for the same logical change).

- [ ] **Step 3: If no teaching_log writer exists yet in code**

Then this task is a no-op for v1. Leave a comment in the spec area where future teaching-log writes will go: "When teaching log is implemented, write one row per assigned instructor with role discriminator." Skip the test, skip the commit, move to Phase 5.

- [ ] **Step 4: If you implemented it, commit**

```bash
git add be
git commit -m "feat(be): teaching log records main + supporting instructors"
```

---

## Phase 5 — Portal class & workshop forms (main/supporting pickers)

### Task 5.1: Class create form

**Files:**
- Modify: `fe-portal/src/app/admin/schedule/new/class/page.tsx`

- [ ] **Step 1: Replace the single instructor select**

Locate the existing `<select>` or instructor picker bound to a single `instructorId` state. Replace with two controls:

1. **Main instructor** — a single `<select>` showing active instructors, required.
2. **Supporting instructors** — a multi-select (chips with remove buttons + a "+ Add instructor" dropdown that excludes the currently-selected main and any already-added supporting).

Skeleton:

```tsx
const [mainInstructorId, setMainInstructorId] = useState<string>("");
const [supportingInstructorIds, setSupportingInstructorIds] = useState<string[]>([]);

const availableForSupporting = instructorsList.filter(
  (i) => i.id !== mainInstructorId && !supportingInstructorIds.includes(i.id),
);
```

Render the chips block:

```tsx
<div>
  <Label>Supporting instructors</Label>
  <div className="flex flex-wrap gap-2">
    {supportingInstructorIds.map((id) => {
      const name = instructorsList.find((i) => i.id === id)?.name ?? "Unknown";
      return (
        <span key={id} className="inline-flex items-center gap-1 rounded-full border border-border bg-paper px-2 py-1 text-xs">
          {name}
          <button type="button" onClick={() => setSupportingInstructorIds((prev) => prev.filter((x) => x !== id))}>×</button>
        </span>
      );
    })}
    {availableForSupporting.length > 0 && (
      <select className="text-xs" value="" onChange={(e) => {
        if (e.target.value) setSupportingInstructorIds((prev) => [...prev, e.target.value]);
      }}>
        <option value="">+ Add supporting instructor</option>
        {availableForSupporting.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
    )}
  </div>
</div>
```

- [ ] **Step 2: Update the submit payload**

```ts
await api.post("/portal/admin/classes", {
  // ... other fields
  mainInstructorId,
  supportingInstructorIds,
});
```

Remove the old `instructorId` key from the payload.

- [ ] **Step 3: Typecheck + build + commit**

```bash
npm run typecheck --prefix fe-portal
npx --prefix fe-portal next build
git add fe-portal/src/app/admin/schedule/new/class/page.tsx
git commit -m "feat(fe-portal): class create form with main+supporting pickers"
```

---

### Task 5.2: Class edit form (schedule detail page)

**Files:**
- Modify: `fe-portal/src/app/admin/schedule/[type]/[id]/page.tsx`

- [ ] **Step 1: Add the same main + supporting controls in the class edit branch**

The detail page handles three (soon four) types. Inside the `type === 'class'` branch's edit form, repeat the same main+supporting UI from Task 5.1. Load existing values from the fetched class detail (`mainInstructorId`, `supportingInstructorIds`).

- [ ] **Step 2: Update PATCH payload**

When saving:

```ts
await api.patch(`/portal/admin/classes/${id}`, {
  // ... changed fields
  mainInstructorId,
  supportingInstructorIds,
});
```

- [ ] **Step 3: Typecheck + build + commit**

```bash
npm run typecheck --prefix fe-portal
npx --prefix fe-portal next build
git add fe-portal/src/app/admin/schedule/[type]/[id]/page.tsx
git commit -m "feat(fe-portal): class edit form supports main+supporting"
```

---

### Task 5.3: Workshop create form

**Files:**
- Modify: `fe-portal/src/app/admin/packages/workshops/new/page.tsx`

- [ ] **Step 1: Replace existing instructor multi-select with main + supporting**

Same UI pattern as Task 5.1. The submit payload changes from:

```ts
{ instructors: [...] }
```

to:

```ts
{ mainInstructorId, supportingInstructorIds }
```

- [ ] **Step 2: Typecheck + build + commit**

```bash
npm run typecheck --prefix fe-portal
npx --prefix fe-portal next build
git add fe-portal/src/app/admin/packages/workshops/new/page.tsx
git commit -m "feat(fe-portal): workshop create form with main+supporting"
```

---

### Task 5.4: Workshop edit form

**Files:**
- Modify: `fe-portal/src/app/admin/packages/workshops/[id]/edit/page.tsx`

- [ ] **Step 1: Same treatment as 5.3 but loading initial values from the fetched workshop**

```ts
const [mainInstructorId, setMainInstructorId] = useState(workshop.mainInstructorId);
const [supportingInstructorIds, setSupportingInstructorIds] = useState<string[]>(workshop.supportingInstructorIds);
```

PATCH payload includes both keys.

- [ ] **Step 2: Typecheck + build + commit**

```bash
npm run typecheck --prefix fe-portal
npx --prefix fe-portal next build
git add fe-portal/src/app/admin/packages/workshops/[id]/edit/page.tsx
git commit -m "feat(fe-portal): workshop edit form supports main+supporting"
```

---

## Phase 6 — fe-client: render main + supporting on class & workshop detail

### Task 6.1: Class detail page

**Files:**
- Locate: `grep -rn "class-detail\|ClassDetail\|/me/classes" fe-client/src --include="*.tsx" --include="*.ts" -l`

- [ ] **Step 1: Open the class detail page**

Typically `fe-client/src/app/(authed)/classes/[id]/page.tsx` or similar. If the project uses a public route, look under `fe-client/src/app/classes/` or `fe-client/src/app/schedule/`.

- [ ] **Step 2: Update the instructor block**

The page currently renders something like `<p>Instructor: {instructor.name}</p>` or a card. Change to:

```tsx
<div className="flex flex-col gap-1">
  <p className="text-sm font-semibold">{mainInstructor.name}</p>
  {supportingInstructors.length > 0 && (
    <p className="text-xs text-muted">
      with {supportingInstructors.map((i) => i.name).join(' & ')}
    </p>
  )}
</div>
```

If the BE response now returns `mainInstructorId` + `supportingInstructorIds`, you'll also need to map IDs to names (likely the page already fetches an instructor catalog or the BE includes hydrated names).

- [ ] **Step 3: Update TypeScript types**

In whatever shared type file fe-client uses for the class detail (`fe-client/src/lib/types.ts` or similar), update the class type:

```ts
export interface Class {
  // ... existing
  mainInstructorId: string;
  supportingInstructorIds: string[];
  // instructorIds: string[]; // kept on BE for back-compat but fe-client should consume the split form
}
```

- [ ] **Step 4: Typecheck + build + commit**

```bash
npm run typecheck --prefix fe-client
npx --prefix fe-client next build
git add fe-client/src
git commit -m "feat(fe-client): class detail shows main + supporting instructors"
```

---

### Task 6.2: Workshop detail page

**Files:**
- Locate: `grep -rn "workshops/" fe-client/src --include="*.tsx" -l`

- [ ] **Step 1: Open the workshop detail page**

- [ ] **Step 2: Apply the same treatment as Task 6.1**

Main instructor prominent. Supporting instructors as a secondary "with X & Y" line.

- [ ] **Step 3: Typecheck + build + commit**

```bash
npm run typecheck --prefix fe-client
npx --prefix fe-client next build
git add fe-client/src
git commit -m "feat(fe-client): workshop detail shows main + supporting instructors"
```

---

## Phase 7 — Corporate session CRUD (BE)

### Task 7.1: Corporate session service (with conflict checks)

**Files:**
- Create: `be/src/services/corporate/sessions.ts`
- Create: `be/src/services/corporate/index.ts` (re-export barrel — optional, mirror existing service folders)
- Test: `be/tests/services/corporate/sessions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { resetTestDb, withTestDb } from '../../helpers/db'
import { createCorporateSession, cancelCorporateSession } from '../../../src/services/corporate/sessions'

describe('corporate sessions service', () => {
  beforeEach(async () => { await resetTestDb() })

  it('creates a session and writes the supporting junction', async () => {
    await withTestDb(async (db) => {
      const seed = await seedCorporateDeps(db)
      const s = await createCorporateSession(db, {
        corporatePackageId: seed.pkg.id,
        clientName: 'DBS Bank',
        mainInstructorId: seed.instructorMain.staffUserId,
        supportingInstructorIds: [seed.instructorSup.staffUserId],
        locationId: seed.location.id,
        roomId: seed.room.id,
        startsAt: new Date('2026-07-01T10:00:00Z'),
        endsAt: new Date('2026-07-01T11:00:00Z'),
        createdByStaffId: seed.staff.id,
      })
      expect(s.id).toBeTruthy()
      expect(s.lifecycle).toBe('active')
    })
  })

  it('rejects when room is double-booked by another active class', async () => {
    // Setup a class in the same room/time, then expect createCorporateSession to throw 'room_conflict'
  })

  it('rejects when main instructor has an overlapping class', async () => {
    // Setup a class with this main instructor at the same time → expect 'instructor_conflict'
  })

  it('allows overlap when only a supporting instructor matches', async () => {
    // Supporting instructors do not block scheduling per D10.
  })

  it('rejects when main is also in supporting', async () => { /* … */ })

  it('rejects when corporate_package is archived', async () => { /* … */ })

  it('cancels a session — sets lifecycle, cancelledAt, cancelledByStaffId', async () => { /* … */ })
})
```

Implement `seedCorporateDeps` to seed: staff, package, two instructors, location, room.

- [ ] **Step 2: Run — expect fail**

```bash
npm test --prefix be -- corporate/sessions
```

- [ ] **Step 3: Implement the service**

```ts
import { and, eq, ne, sql, or, lt, gt } from 'drizzle-orm'
import type { Db } from '../../db/types'
import {
  corporateSessions,
  corporateSessionSupportingInstructors,
  classes,
  classSupportingInstructors,
  workshopDays,
  ptSessions,
} from '../../db/schema/schedule'
import { corporatePackages } from '../../db/schema/packages'

export interface CreateCorporateSessionInput {
  corporatePackageId: string
  clientName: string
  mainInstructorId: string
  supportingInstructorIds: string[]
  locationId: string
  roomId: string
  startsAt: Date
  endsAt: Date
  createdByStaffId: string
}

export type CreateCorporateSessionResult =
  | { ok: true; session: typeof corporateSessions.$inferSelect }
  | { ok: false; error: 'package_archived' | 'package_not_found' | 'room_conflict' | 'instructor_conflict' | 'main_in_supporting' | 'bad_time_range' }

export async function createCorporateSession(
  db: Db,
  input: CreateCorporateSessionInput,
): Promise<CreateCorporateSessionResult> {
  if (input.endsAt <= input.startsAt) return { ok: false, error: 'bad_time_range' }
  if (input.supportingInstructorIds.includes(input.mainInstructorId)) {
    return { ok: false, error: 'main_in_supporting' }
  }

  // Package must exist and be active
  const [pkg] = await db.select().from(corporatePackages).where(eq(corporatePackages.id, input.corporatePackageId)).limit(1)
  if (!pkg) return { ok: false, error: 'package_not_found' }
  if (pkg.status !== 'active') return { ok: false, error: 'package_archived' }

  // Conflict check helpers — overlap means existing.startsAt < new.endsAt AND existing.endsAt > new.startsAt
  const startsAt = input.startsAt
  const endsAt = input.endsAt

  // 1. Room conflict — against active classes, workshop_days, pt_sessions, corporate_sessions in the same room+window
  const roomClass = await db.select({ id: classes.id }).from(classes).where(and(
    eq(classes.roomId, input.roomId),
    eq(classes.lifecycle, 'active'),
    lt(classes.startsAt, endsAt),
    gt(classes.endsAt, startsAt),
  )).limit(1)
  if (roomClass.length > 0) return { ok: false, error: 'room_conflict' }

  const roomWorkshopDay = await db.select({ id: workshopDays.id }).from(workshopDays).where(and(
    eq(workshopDays.roomId, input.roomId),
    lt(workshopDays.startsAt, endsAt),
    gt(workshopDays.endsAt, startsAt),
  )).limit(1)
  if (roomWorkshopDay.length > 0) return { ok: false, error: 'room_conflict' }

  const roomPt = await db.select({ id: ptSessions.id }).from(ptSessions).where(and(
    eq(ptSessions.roomId, input.roomId),
    eq(ptSessions.lifecycle, 'active'),
    lt(ptSessions.startsAt, endsAt),
    gt(ptSessions.endsAt, startsAt),
  )).limit(1)
  if (roomPt.length > 0) return { ok: false, error: 'room_conflict' }

  const roomCorp = await db.select({ id: corporateSessions.id }).from(corporateSessions).where(and(
    eq(corporateSessions.roomId, input.roomId),
    eq(corporateSessions.lifecycle, 'active'),
    lt(corporateSessions.startsAt, endsAt),
    gt(corporateSessions.endsAt, startsAt),
  )).limit(1)
  if (roomCorp.length > 0) return { ok: false, error: 'room_conflict' }

  // 2. Main instructor conflict — against any active class/workshop_day/pt/corp where THIS instructor is the main
  const instClass = await db.select({ id: classes.id }).from(classes).where(and(
    eq(classes.mainInstructorId, input.mainInstructorId),
    eq(classes.lifecycle, 'active'),
    lt(classes.startsAt, endsAt),
    gt(classes.endsAt, startsAt),
  )).limit(1)
  if (instClass.length > 0) return { ok: false, error: 'instructor_conflict' }

  const instPt = await db.select({ id: ptSessions.id }).from(ptSessions).where(and(
    eq(ptSessions.instructorId, input.mainInstructorId),
    eq(ptSessions.lifecycle, 'active'),
    lt(ptSessions.startsAt, endsAt),
    gt(ptSessions.endsAt, startsAt),
  )).limit(1)
  if (instPt.length > 0) return { ok: false, error: 'instructor_conflict' }

  const instCorp = await db.select({ id: corporateSessions.id }).from(corporateSessions).where(and(
    eq(corporateSessions.mainInstructorId, input.mainInstructorId),
    eq(corporateSessions.lifecycle, 'active'),
    lt(corporateSessions.startsAt, endsAt),
    gt(corporateSessions.endsAt, startsAt),
  )).limit(1)
  if (instCorp.length > 0) return { ok: false, error: 'instructor_conflict' }

  // (Workshops have no single "main instructor" timestamp — workshop_days hold the time. To detect a
  // main-instructor conflict on a workshop, join workshop_days → workshops → workshop_instructors WHERE role='main')
  const instWorkshop = await db.execute(sql`
    SELECT wd.id FROM workshop_days wd
    JOIN workshops w ON w.id = wd.workshop_id
    JOIN workshop_instructors wi ON wi.workshop_id = w.id AND wi.role = 'main'
    WHERE wi.instructor_id = ${input.mainInstructorId}
      AND w.lifecycle = 'active'
      AND wd.starts_at < ${endsAt.toISOString()}
      AND wd.ends_at > ${startsAt.toISOString()}
    LIMIT 1
  `)
  if (instWorkshop.rowCount && instWorkshop.rowCount > 0) return { ok: false, error: 'instructor_conflict' }

  // Insert
  const session = await db.transaction(async (tx) => {
    const [s] = await tx.insert(corporateSessions).values({
      corporatePackageId: input.corporatePackageId,
      clientName: input.clientName,
      mainInstructorId: input.mainInstructorId,
      locationId: input.locationId,
      roomId: input.roomId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdByStaffId: input.createdByStaffId,
    }).returning()

    if (input.supportingInstructorIds.length > 0) {
      const supports = Array.from(new Set(input.supportingInstructorIds))
      await tx.insert(corporateSessionSupportingInstructors).values(
        supports.map((id) => ({ corporateSessionId: s.id, instructorId: id })),
      )
    }
    return s
  })

  return { ok: true, session }
}

export async function getCorporateSession(db: Db, id: string) {
  const [row] = await db.select().from(corporateSessions).where(eq(corporateSessions.id, id)).limit(1)
  if (!row) return null
  const supports = await db.select({ id: corporateSessionSupportingInstructors.instructorId })
    .from(corporateSessionSupportingInstructors)
    .where(eq(corporateSessionSupportingInstructors.corporateSessionId, id))
  return { ...row, supportingInstructorIds: supports.map((s) => s.id) }
}

export async function cancelCorporateSession(db: Db, id: string, staffId: string) {
  const [row] = await db.update(corporateSessions)
    .set({ lifecycle: 'cancelled', cancelledAt: new Date(), cancelledByStaffId: staffId })
    .where(and(eq(corporateSessions.id, id), eq(corporateSessions.lifecycle, 'active')))
    .returning()
  return row ?? null
}

export async function rescheduleCorporateSession(db: Db, id: string, patch: Partial<CreateCorporateSessionInput>) {
  // Re-run conflict checks against the patched values + commit changes. Mirror createCorporateSession's
  // conflict logic; exclude the row being updated from each conflict scan (add `ne(...id, id)` to the where).
  // Implementation left to the engineer — same pattern, with the row's own ID excluded from conflict scans.
  // Update the session row + replace the supporting junction in a transaction.
}
```

The `rescheduleCorporateSession` stub above leaves the body to the engineer to fill in by mirroring `createCorporateSession`'s conflict logic, but excluding the row being patched from each conflict scan (add `ne(corporateSessions.id, id)` to the corp room/instructor scans).

- [ ] **Step 4: Run — expect pass**

```bash
npm test --prefix be -- corporate/sessions
```

- [ ] **Step 5: Commit**

```bash
git add be/src/services/corporate be/tests/services/corporate
git commit -m "feat(be): corporate-sessions service with conflict checks"
```

---

### Task 7.2: Corporate session routes

**Files:**
- Create: `be/src/routes/portal/admin/corporate-sessions.ts`
- Test: `be/tests/routes/portal/admin/corporate-sessions.test.ts`

- [ ] **Step 1: Write the failing route tests**

Mirror `corporate-packages.test.ts` shape. Cover:

- `POST /` happy path returns 201 with the created session.
- `POST /` returns 409 with `error: 'room_conflict'` when room is busy.
- `POST /` returns 409 with `error: 'instructor_conflict'` when main is busy.
- `POST /` returns 422 with `error: 'package_archived'` when the package is archived.
- `POST /:id/cancel` flips lifecycle to 'cancelled'.
- `GET /:id` returns the hydrated session with `supportingInstructorIds`.
- `PATCH /:id` reschedules (with conflict re-check).

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement the route**

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { AdminEnv } from '../../../types/hono-env'
import {
  createCorporateSession,
  getCorporateSession,
  cancelCorporateSession,
  rescheduleCorporateSession,
} from '../../../services/corporate/sessions'

const createSchema = z.object({
  corporatePackageId: z.string().uuid(),
  clientName: z.string().min(1).max(200),
  mainInstructorId: z.string().uuid(),
  supportingInstructorIds: z.array(z.string().uuid()).default([]),
  locationId: z.string().uuid(),
  roomId: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
})

const patchSchema = createSchema.partial()

export const corporateSessionsRoutes = new Hono<AdminEnv>()

corporateSessionsRoutes.post('/', zValidator('json', createSchema), async (c) => {
  const db = c.get('db')
  const staff = c.get('staffUser')
  const input = c.req.valid('json')
  const result = await createCorporateSession(db, {
    ...input,
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
    createdByStaffId: staff.id,
  })
  if (!result.ok) {
    const code = result.error === 'package_archived' ? 422
              : result.error === 'package_not_found' ? 404
              : result.error === 'bad_time_range' ? 400
              : result.error === 'main_in_supporting' ? 400
              : 409
    return c.json({ error: result.error }, code)
  }
  return c.json({ corporateSession: result.session }, 201)
})

corporateSessionsRoutes.get('/:id', async (c) => {
  const db = c.get('db')
  const row = await getCorporateSession(db, c.req.param('id'))
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json({ corporateSession: row })
})

corporateSessionsRoutes.patch('/:id', zValidator('json', patchSchema), async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const input = c.req.valid('json')
  const patch = {
    ...input,
    ...(input.startsAt ? { startsAt: new Date(input.startsAt) } : {}),
    ...(input.endsAt ? { endsAt: new Date(input.endsAt) } : {}),
  } as any
  const result = await rescheduleCorporateSession(db, id, patch)
  if (!result || !result.ok) {
    const code = result?.error === 'package_archived' ? 422
              : result?.error === 'package_not_found' ? 404
              : 409
    return c.json({ error: result?.error ?? 'unknown' }, code)
  }
  return c.json({ corporateSession: result.session })
})

corporateSessionsRoutes.post('/:id/cancel', async (c) => {
  const db = c.get('db')
  const staff = c.get('staffUser')
  const row = await cancelCorporateSession(db, c.req.param('id'), staff.id)
  if (!row) return c.json({ error: 'not_found_or_already_cancelled' }, 404)
  return c.json({ corporateSession: row })
})
```

The `rescheduleCorporateSession` result type should mirror `CreateCorporateSessionResult` so the route can switch on the same error codes.

- [ ] **Step 4: Wire into `be/src/routes/portal/admin/index.ts`**

```ts
import { corporateSessionsRoutes } from './corporate-sessions'
// ...
adminRouter.route('/corporate-sessions', corporateSessionsRoutes)
```

- [ ] **Step 5: Run + commit**

```bash
npm test --prefix be -- corporate
git add be
git commit -m "feat(be): corporate-sessions routes"
```

---

### Task 7.3: Extend the schedule aggregator with corporate entries

**Files:**
- Modify: `be/src/services/schedule/timetable.ts` (or whichever service powers `GET /portal/admin/schedule`)

- [ ] **Step 1: Write a failing test**

In the schedule aggregator's test file, add:

```ts
it('includes corporate sessions in the unified schedule output', async () => {
  await withTestDb(async (db) => {
    const seed = await seedCorporateDeps(db)
    const sess = await createCorporateSession(db, { /* ... */ })
    const result = await fetchSchedule(db, { from: '...', to: '...', locationId: seed.location.id })
    const entry = result.find(e => e.kind === 'corporate' && e.id === sess.session.id)
    expect(entry).toBeDefined()
    expect(entry?.subtitle).toBe('DBS Bank')
    expect(entry?.mainInstructorId).toBe(seed.instructorMain.staffUserId)
  })
})
```

- [ ] **Step 2: Add the corporate branch to the aggregator**

Inside the function that builds the schedule entries (currently has class / workshop / pt branches), add a fourth pull:

```ts
const corporateRows = await db.select({
  id: corporateSessions.id,
  packageId: corporateSessions.corporatePackageId,
  packageName: corporatePackages.name,
  clientName: corporateSessions.clientName,
  startsAt: corporateSessions.startsAt,
  endsAt: corporateSessions.endsAt,
  locationId: corporateSessions.locationId,
  roomId: corporateSessions.roomId,
  mainInstructorId: corporateSessions.mainInstructorId,
  lifecycle: corporateSessions.lifecycle,
}).from(corporateSessions)
  .innerJoin(corporatePackages, eq(corporatePackages.id, corporateSessions.corporatePackageId))
  .where(and(
    locationFilter ? eq(corporateSessions.locationId, locationFilter) : undefined,
    lt(corporateSessions.startsAt, toDate),
    gt(corporateSessions.endsAt, fromDate),
  ))

// Pull supporting in one round-trip
const corpIds = corporateRows.map(r => r.id)
const supportRows = corpIds.length === 0
  ? []
  : await db.select().from(corporateSessionSupportingInstructors)
      .where(inArray(corporateSessionSupportingInstructors.corporateSessionId, corpIds))
const supportByCorpId = new Map<string, string[]>()
for (const s of supportRows) {
  const arr = supportByCorpId.get(s.corporateSessionId) ?? []
  arr.push(s.instructorId)
  supportByCorpId.set(s.corporateSessionId, arr)
}

const corporateEntries = corporateRows.map((r) => {
  const supportingInstructorIds = supportByCorpId.get(r.id) ?? []
  return {
    kind: 'corporate' as const,
    id: r.id,
    label: r.packageName,
    subtitle: r.clientName,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    locationId: r.locationId,
    roomId: r.roomId,
    mainInstructorId: r.mainInstructorId,
    supportingInstructorIds,
    instructorIds: [r.mainInstructorId, ...supportingInstructorIds],
    eventState: r.lifecycle === 'cancelled' ? 'cancelled' : 'active',
    capacity: null,
    bookedCount: null,
    raw: { corporatePackageId: r.packageId },
  }
})

return [...classEntries, ...workshopEntries, ...ptEntries, ...corporateEntries]
```

- [ ] **Step 3: Handle filter param `?type=corporate`**

In the route that calls this aggregator (probably `be/src/routes/portal/admin/schedule.ts`), ensure the existing `?type=` filter accepts `corporate`. Also extend the instructor filter to match if the selected instructor is in `entry.instructorIds`.

- [ ] **Step 4: Run all be tests**

```bash
npm test --prefix be
```

- [ ] **Step 5: Commit**

```bash
git add be
git commit -m "feat(be): schedule aggregator emits corporate entries"
```

---

## Phase 8 — Portal corporate session scheduling

### Task 8.1: Add the "Corporate ▼" dropdown to the schedule page

**Files:**
- Modify: `fe-portal/src/app/admin/schedule/page.tsx`

- [ ] **Step 1: Fetch active corporate packages**

Inside the `useEffect` that already loads `instructorsList` and `workshopsList`, add a third parallel fetch:

```ts
const [ins, wsh, cps] = await Promise.all([
  api.get<{ instructors: ApiInstructor[] }>("/portal/admin/instructors"),
  api.get<{ workshops: ApiWorkshop[] }>("/portal/admin/workshops"),
  api.get<{ corporatePackages: ApiCorporatePackage[] }>("/portal/admin/corporate-packages?status=active"),
]);
setInstructorsList(ins.instructors);
setWorkshopsList(wsh.workshops);
setCorporatePackagesList(cps.corporatePackages);
```

Add the type:

```ts
interface ApiCorporatePackage {
  id: string;
  name: string;
  priceSgd: string;
  status: 'active' | 'archived';
}
```

Add state:

```ts
const [corporatePackagesList, setCorporatePackagesList] = useState<ApiCorporatePackage[]>([]);
const [corporateMenuOpen, setCorporateMenuOpen] = useState(false);
```

- [ ] **Step 2: Add the dropdown button next to the Workshop one**

Insert between the Workshop dropdown and the PT button:

```tsx
<div className="relative">
  <Button variant="secondary" size="sm" onClick={() => setCorporateMenuOpen((o) => !o)}>
    Corporate <ChevronDown className="h-3.5 w-3.5" />
  </Button>
  {corporateMenuOpen && (
    <div className="absolute right-0 z-30 mt-2 w-72 rounded-lg border border-border bg-card p-2 shadow-soft">
      {corporatePackagesList.length === 0 && (
        <div className="px-3 py-2 text-xs text-muted">No corporate packages configured.</div>
      )}
      {corporatePackagesList.map((p) => (
        <Link
          key={p.id}
          href={`/admin/schedule/new/corporate?packageId=${p.id}`}
          onClick={() => setCorporateMenuOpen(false)}
          className="block rounded px-3 py-2 text-sm hover:bg-paper"
        >
          {p.name} <span className="text-muted">· S${p.priceSgd}</span>
        </Link>
      ))}
      <div className="mt-1 border-t border-border pt-1">
        <Link
          href="/admin/packages/corporate/new"
          onClick={() => setCorporateMenuOpen(false)}
          className="inline-flex w-full items-center gap-1 rounded px-3 py-2 text-sm text-accent hover:bg-paper"
        >
          <Plus className="h-3.5 w-3.5" /> New corporate package
        </Link>
        <Link
          href="/admin/packages/corporate"
          onClick={() => setCorporateMenuOpen(false)}
          className="block rounded px-3 py-2 text-xs text-muted hover:bg-paper"
        >
          Manage corporate packages →
        </Link>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 3: Typecheck + build + commit**

```bash
npm run typecheck --prefix fe-portal
npx --prefix fe-portal next build
git add fe-portal/src/app/admin/schedule/page.tsx
git commit -m "feat(fe-portal): corporate dropdown on schedule"
```

---

### Task 8.2: Filter pill, color, legend for corporate

**Files:**
- Modify: `fe-portal/src/app/admin/schedule/page.tsx`
- Modify: `fe-portal/src/lib/use-schedule.ts` (where `ScheduleEntry` is typed)

- [ ] **Step 1: Extend the `FilterType` union and filter pill options**

In `schedule/page.tsx`:

```ts
type FilterType = "all" | "class" | "workshop" | "pt" | "corporate";
```

In the filter pill render:

```tsx
options={[
  { val: "all", label: "All" },
  { val: "class", label: "Class" },
  { val: "workshop", label: "Workshop" },
  { val: "pt", label: "Private" },
  { val: "corporate", label: "Corporate" },
]}
```

- [ ] **Step 2: Extend `ScheduleEntry` in `use-schedule.ts`**

Add a `'corporate'` discriminant:

```ts
| {
    kind: 'corporate';
    id: string;
    label: string;
    subtitle: string;  // clientName
    startsAt: string;
    endsAt: string;
    locationId: string;
    roomId: string | null;
    mainInstructorId: string;
    supportingInstructorIds: string[];
    instructorIds: string[];
    eventState: 'active' | 'cancelled';
    capacity: number | null;
    bookedCount: number | null;
    raw: { corporatePackageId: string };
  }
```

- [ ] **Step 3: Update `kindClasses()` and `Legend()`**

In `kindClasses` switch:

```ts
case "corporate":
  return "bg-slate-200/60 border-slate-500 text-slate-700 hover:bg-slate-200/90";
```

If the project's theme uses different tokens (e.g. `gray` instead of `slate`), match the closest neutral available. The visual goal: clearly distinct from cyan (class), warning/yellow (workshop), and accent/purple (PT).

In `Legend` items array:

```ts
{ kind: "corporate", label: "Corporate" },
```

Add a corresponding `kind === "corporate"` swatch class in the JSX.

- [ ] **Step 4: Update `EventBlock` subtitle for corporate**

In `EventBlock`, the subtitle currently joins instructor names + location. For corporate, prefer `clientName` + roomName. Inside the component:

```ts
const subtitle =
  entry.kind === 'pt'
    ? entry.instructorIds.map(resolver.instructorName).join(' & ')
    : entry.kind === 'corporate'
      ? `${entry.subtitle} · ${resolver.locationName(entry.locationId)}`
      : `${entry.instructorIds.map(resolver.instructorName).join(' & ')} · ${resolver.locationName(entry.locationId)}`
```

- [ ] **Step 5: Typecheck + build + commit**

```bash
npm run typecheck --prefix fe-portal
npx --prefix fe-portal next build
git add fe-portal/src
git commit -m "feat(fe-portal): corporate filter, color, legend, tile subtitle"
```

---

### Task 8.3: New corporate-session creation page

**Files:**
- Create: `fe-portal/src/app/admin/schedule/new/corporate/page.tsx`

- [ ] **Step 1: Sister-template**

Open `fe-portal/src/app/admin/schedule/new/class/page.tsx` (the class create page with main+supporting picker you built in Task 5.1). It already handles location → room cascading, date/time pickers, instructor picker.

- [ ] **Step 2: Build the corporate session form**

Mirror that template. Differences:

| Class form | Corporate form |
|---|---|
| Class type picker | (removed) |
| Capacity / credit cost fields | (removed) |
| Submit to `/portal/admin/classes` | Submit to `/portal/admin/corporate-sessions` |
| Title "New Class" | "New Corporate Session" |
| (no client name) | Client name (free-text required) |
| (no package context) | Package shown as a locked read-only summary at top (name + price), loaded from `?packageId` query param |

Skeleton:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Label, PageHeader } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";

export default function NewCorporateSessionPage() {
  const router = useRouter();
  const search = useSearchParams();
  const packageId = search.get("packageId") ?? "";
  const { api, activeLocationId } = useWorkspace();

  const [pkg, setPkg] = useState<{ name: string; priceSgd: string } | null>(null);
  const [clientName, setClientName] = useState("");
  const [mainInstructorId, setMainInstructorId] = useState("");
  const [supportingInstructorIds, setSupportingInstructorIds] = useState<string[]>([]);
  const [locationId, setLocationId] = useState(activeLocationId ?? "");
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState("");        // YYYY-MM-DD
  const [startTime, setStartTime] = useState(""); // HH:mm
  const [endTime, setEndTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [instructorsList, setInstructorsList] = useState<{id: string; name: string}[]>([]);
  const [roomsList, setRoomsList] = useState<{id: string; name: string; locationId: string}[]>([]);

  useEffect(() => {
    if (!api || !packageId) return;
    let cancelled = false;
    void (async () => {
      const [p, ins, rms] = await Promise.all([
        api.get<{ corporatePackage: any }>(`/portal/admin/corporate-packages/${packageId}`),
        api.get<{ instructors: any[] }>("/portal/admin/instructors"),
        api.get<{ rooms: any[] }>("/portal/admin/rooms"),
      ]);
      if (cancelled) return;
      setPkg({ name: p.corporatePackage.name, priceSgd: p.corporatePackage.priceSgd });
      setInstructorsList(ins.instructors.filter((i: any) => i.status === 'active' && !i.archived_at));
      setRoomsList(rms.rooms);
    })();
    return () => { cancelled = true; };
  }, [api, packageId]);

  const roomsForLocation = roomsList.filter((r) => r.locationId === locationId);
  const availableSupporting = instructorsList.filter(
    (i) => i.id !== mainInstructorId && !supportingInstructorIds.includes(i.id),
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const startsAt = new Date(`${date}T${startTime}:00`).toISOString();
      const endsAt = new Date(`${date}T${endTime}:00`).toISOString();
      await api.post("/portal/admin/corporate-sessions", {
        corporatePackageId: packageId,
        clientName,
        mainInstructorId,
        supportingInstructorIds,
        locationId,
        roomId,
        startsAt,
        endsAt,
      });
      router.push("/admin/schedule");
    } catch (err: any) {
      setError(err?.body?.error ?? err?.message ?? "Failed to create");
      setSubmitting(false);
    }
  }

  if (!packageId) return <p>Missing packageId.</p>;
  if (!pkg) return <p>Loading…</p>;

  return (
    <div>
      <PageHeader title="New corporate session" description={`Booking ${pkg.name} (S$${pkg.priceSgd})`} />
      <form onSubmit={onSubmit} className="max-w-2xl space-y-4 rounded-xl border border-border bg-card p-6 shadow-soft">
        <div>
          <Label htmlFor="client">Client name</Label>
          <Input id="client" value={clientName} onChange={(e) => setClientName(e.target.value)} required placeholder="e.g. DBS Bank" />
        </div>

        <div>
          <Label htmlFor="main">Main instructor</Label>
          <select id="main" required value={mainInstructorId}
            onChange={(e) => setMainInstructorId(e.target.value)}
            className="w-full rounded-md border border-border bg-card px-2 py-1 text-sm">
            <option value="">Select an instructor</option>
            {instructorsList.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>

        <div>
          <Label>Supporting instructors (optional)</Label>
          <div className="flex flex-wrap gap-2">
            {supportingInstructorIds.map((id) => {
              const name = instructorsList.find((i) => i.id === id)?.name ?? "Unknown";
              return (
                <span key={id} className="inline-flex items-center gap-1 rounded-full border border-border bg-paper px-2 py-1 text-xs">
                  {name}
                  <button type="button" onClick={() => setSupportingInstructorIds((p) => p.filter((x) => x !== id))}>×</button>
                </span>
              );
            })}
            {availableSupporting.length > 0 && (
              <select value="" onChange={(e) => {
                if (e.target.value) setSupportingInstructorIds((p) => [...p, e.target.value]);
              }} className="rounded-md border border-border bg-card px-2 py-1 text-xs">
                <option value="">+ Add supporting</option>
                {availableSupporting.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="loc">Location</Label>
            <select id="loc" required value={locationId} onChange={(e) => { setLocationId(e.target.value); setRoomId(""); }}
              className="w-full rounded-md border border-border bg-card px-2 py-1 text-sm">
              <option value="">Select</option>
              {/* You'll need a locations list — fetch from /portal/admin/locations, mirror existing class form */}
            </select>
          </div>
          <div>
            <Label htmlFor="room">Room</Label>
            <select id="room" required value={roomId} onChange={(e) => setRoomId(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-2 py-1 text-sm" disabled={!locationId}>
              <option value="">Select</option>
              {roomsForLocation.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="start">Start</Label>
            <Input id="start" type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="end">End</Label>
            <Input id="end" type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm text-error">{error}</p>}

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>{submitting ? "Scheduling…" : "Schedule"}</Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
```

Add the locations fetch + dropdown alongside the rooms fetch — mirror exactly what the existing class form does for the location picker.

- [ ] **Step 3: Typecheck + build + commit**

```bash
npm run typecheck --prefix fe-portal
npx --prefix fe-portal next build
git add fe-portal/src/app/admin/schedule/new/corporate/page.tsx
git commit -m "feat(fe-portal): new corporate session form"
```

---

### Task 8.4: Schedule detail page handles `type=corporate`

**Files:**
- Modify: `fe-portal/src/app/admin/schedule/[type]/[id]/page.tsx`

- [ ] **Step 1: Add a `corporate` branch to the existing type switch**

The page currently handles `class`, `workshop`, `pt`. Add a `corporate` branch:

- Fetch from `GET /portal/admin/corporate-sessions/:id`.
- Render: package name (link to `/admin/packages/corporate/<packageId>/edit`), client name, main instructor, supporting instructors, location, room, start/end time, lifecycle.
- Edit form: same fields as the create form (Task 8.3), but pre-populated. PATCH on save.
- Cancel button: `POST /:id/cancel`.

- [ ] **Step 2: Typecheck + build + commit**

```bash
npm run typecheck --prefix fe-portal
npx --prefix fe-portal next build
git add fe-portal/src/app/admin/schedule/[type]/[id]/page.tsx
git commit -m "feat(fe-portal): corporate session detail/edit page"
```

---

## Phase 9 — Final integration check

### Task 9.1: Full BE test pass

- [ ] **Step 1: Run**

```bash
npm test --prefix be
```

Expected: PASS.

- [ ] **Step 2: If anything fails, fix and commit**

Common breakage areas after the rename:
- Stale references to `classes.instructor_id` in services not touched yet.
- Mock data in tests using the old field name.
- Hardcoded SQL in any seed script.

---

### Task 9.2: Frontends typecheck + build

- [ ] **Step 1: Run both**

```bash
npm run typecheck --prefix fe-portal && npx --prefix fe-portal next build
npm run typecheck --prefix fe-client && npx --prefix fe-client next build
```

Expected: PASS.

- [ ] **Step 2: Fix any remaining types**

If fe-client still references `instructorId` (singular) anywhere, replace with `mainInstructorId` and consume `supportingInstructorIds` where appropriate.

---

### Task 9.3: Manual smoke-test on local dev

- [ ] **Step 1: Start the BE**

```bash
npm run dev --prefix be
```

- [ ] **Step 2: Start fe-portal**

```bash
npm run dev --prefix fe-portal
```

- [ ] **Step 3: Walk the corporate happy path in the portal UI**

1. Log in as admin.
2. Sidebar → Packages → Corporate. Confirm empty state on first visit, "New corporate package" works.
3. Create a package called "Corporate 60min Vinyasa" / $400.
4. Sidebar → Schedule. Confirm "Corporate ▼" dropdown lists the package.
5. Click the package → form opens at `/admin/schedule/new/corporate?packageId=...`.
6. Fill in fields, submit → redirects to schedule, new entry appears in the unified calendar with the corporate color/legend chip.
7. Click the calendar entry → detail page shows correct fields, supports cancel + reschedule.
8. Open fe-client and confirm corporate is NOT visible anywhere.

- [ ] **Step 4: Walk the main/supporting path**

1. Create a new class with one main + one supporting instructor; confirm both round-trip via edit.
2. fe-client class detail page shows "with <Supporting>" below the main instructor name.
3. Repeat for a workshop.

- [ ] **Step 5: No code changes — manual verification only.**

---

### Task 9.4: Final commit + open PR

- [ ] **Step 1: Confirm branch state**

```bash
git status
git log --oneline -30
```

Expected: clean tree, no uncommitted changes.

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin <branch>
gh pr create --title "feat: corporate package + main/supporting instructors" --body "Implements docs/superpowers/specs/2026-05-23-corporate-package-and-main-supporting-instructors-design.md"
```
