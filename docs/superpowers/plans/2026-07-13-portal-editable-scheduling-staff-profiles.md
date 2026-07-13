# Portal Editable Scheduling, Per-Instructor Pay & Staff Profiles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scheduled classes/PT/workshops fully editable after creation, tie instructor pay to each named instructor, allow multiple instructors on PT sessions, and give every staff account a full editable profile.

**Architecture:** Additive Drizzle migration first (new pay columns on existing instructor-join tables, a new PT supporting-instructor join, new `staff_users` profile columns, two data backfills). Then BE services/routes (payroll pay-per-instructor, staff profile update, PT session PATCH). Then fe-portal edit UIs wired to existing + new endpoints. No new deps, no new env vars.

**Tech Stack:** Hono + Drizzle + Postgres (`be/`), Next.js App Router + Tailwind + shadcn (`fe-portal/`).

## Global Constraints

- No business logic in route files — routes do `auth → zod parse → call service → format response`. Domain rules live in `services/*`. (verbatim from CLAUDE.md)
- Single `drizzle.config.ts`, single migration history — one migration for this whole plan. `drizzle-kit generate` works (migrations re-baselined). Never add `db:generate` to an automated target. Hand-author the backfill SQL into the generated migration; workflow in `be/src/db/migrations/README.md`.
- No BE test framework. Verify BE with `npx tsc --noEmit` in `be/` (no `typecheck` script). Verify FE with `npx tsc --noEmit` **and** `npm run build` in `fe-portal/` (`npm run lint` is broken — do not gate on it).
- Reuse the existing `client_gender` enum for staff gender — do NOT mint a new enum.
- Keep `fe-client/`, `fe-portal/`, `be/` decoupled — no shared deps.
- Commit messages: NO `Co-Authored-By` / `Generated with Claude` trailers. Human-attributed only.
- Instructor FKs point to `instructors.staffUserId`, not `staff_users.id`.

---

## File Structure

**Backend (`be/`):**
- `src/db/schema/schedule.ts` — add `pay_sgd` to `class_supporting_instructors` & `workshop_instructors`; add `pt_session_supporting_instructors` table.
- `src/db/schema/identity.ts` — add profile columns to `staff_users`.
- `src/db/schema/catalog.ts` — drop `bio`/`phone` from `instructors` (moved up).
- `src/db/migrations/NNNN_*.sql` — generated + hand-added backfill SQL.
- `src/lib/name.ts` (create) — `splitName()` / `joinName()` + `src/lib/name.test.ts` self-check.
- `src/services/payroll/*` — union pay across main + supporting joins + workshops.
- `src/services/staff/*` — profile update.
- `src/services/scheduling/pt-sessions.ts` (or existing PT service) — `updatePtSession()`.
- `src/routes/portal/admin/staff.ts` — `PATCH /:id` profile update; extend invite payload.
- `src/routes/portal/admin/pt-sessions.ts` — `PATCH /:id`.
- `src/routes/portal/admin/schedule.ts` / `workshops.ts` — accept `pay_sgd` per supporting/workshop instructor in existing PATCHes.

**Frontend (`fe-portal/`):**
- `src/app/admin/schedule/[type]/[id]/page.tsx` — `ClassDetail` full edit form; `PtDetail` cancel + edit.
- `src/components/workshops/workshop-editor.tsx` — finish day/tier edit (remove line ~353 stub).
- `src/app/admin/staff/page.tsx` (+ new `staff-edit-dialog.tsx`) — profile edit form.

---

## Phase 1 — Schema & migration (foundational)

### Task 1: Per-instructor pay columns + PT supporting-instructor join

**Files:**
- Modify: `be/src/db/schema/schedule.ts` (`class_supporting_instructors`, `workshop_instructors`; add `pt_session_supporting_instructors`)
- Generate: `be/src/db/migrations/` (drizzle-kit)

**Interfaces:**
- Produces: `classSupportingInstructors.paySgd`, `workshopInstructors.paySgd` (numeric, nullable); table `ptSessionSupportingInstructors { ptSessionId, instructorId, paySgd }`.

- [ ] **Step 1: Add `pay_sgd` to the two existing joins.** In `schedule.ts`, on `class_supporting_instructors` and `workshop_instructors` add:

```ts
paySgd: numeric('pay_sgd', { precision: 10, scale: 2 }),
```

Match the precision/scale already used by `classes.instructorPaySgd` (grep it first and copy exactly).

- [ ] **Step 2: Add the PT supporting-instructor join** in `schedule.ts`, mirroring `class_supporting_instructors`:

```ts
export const ptSessionSupportingInstructors = pgTable('pt_session_supporting_instructors', {
  ptSessionId: uuid('pt_session_id').notNull().references(() => ptSessions.id, { onDelete: 'cascade' }),
  instructorId: uuid('instructor_id').notNull().references(() => instructors.staffUserId, { onDelete: 'restrict' }),
  paySgd: numeric('pay_sgd', { precision: 10, scale: 2 }),
}, (t) => ({
  pk: primaryKey({ columns: [t.ptSessionId, t.instructorId] }),
}))
```

Copy the exact `references`/`onDelete` conventions from `class_supporting_instructors` (grep it — do not guess the FK targets).

- [ ] **Step 3: Generate the migration.** Run in `be/`: `npx drizzle-kit generate`. Confirm one new `.sql` appears under `src/db/migrations/` with the three schema changes and nothing else.

- [ ] **Step 4: Verify types.** Run in `be/`: `npx tsc --noEmit`. Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add be/src/db/schema/schedule.ts be/src/db/migrations
git commit -m "feat(be): per-instructor pay columns + PT supporting-instructor join"
```

### Task 2: Staff profile columns + backfills

**Files:**
- Modify: `be/src/db/schema/identity.ts` (`staff_users`)
- Modify: `be/src/db/schema/catalog.ts` (`instructors` — drop `bio`, `phone`)
- Modify: the generated migration from Task 1 (or a new one) to add backfill SQL

**Interfaces:**
- Produces: `staffUsers.firstName/lastName/phone/address/gender/bio/languages`; `instructors` no longer has `bio`/`phone`.

- [ ] **Step 1: Add columns to `staff_users`** in `identity.ts` (import `clientGenderEnum` — already imported there for clients):

```ts
firstName: text('first_name'),
lastName: text('last_name'),
phone: text('phone'),
address: text('address'),
gender: clientGenderEnum('gender'),
bio: text('bio'),
languages: text('languages').array().notNull().default(sql`'{}'`),
```

- [ ] **Step 2: Remove `bio` and `phone` from `instructors`** in `catalog.ts` (keep `photoR2Key` + relations).

- [ ] **Step 3: Generate migration.** Run `npx drizzle-kit generate` in `be/`. It will add the staff columns and drop the instructor columns.

- [ ] **Step 4: Hand-add backfill SQL** to the generated migration file, BEFORE the `instructors` column drops and AFTER the `staff_users` column adds:

```sql
-- split combined name into first/last (first token → first_name, remainder → last_name)
UPDATE staff_users SET
  first_name = split_part(name, ' ', 1),
  last_name  = NULLIF(regexp_replace(name, '^\S+\s*', ''), '');

-- lift existing instructor bio/phone up to staff_users
UPDATE staff_users s SET
  bio   = COALESCE(s.bio, i.bio),
  phone = COALESCE(s.phone, i.phone)
FROM instructors i
WHERE i.staff_user_id = s.id;
```

*Order matters: the two `UPDATE`s must run before the `ALTER TABLE instructors DROP COLUMN bio/phone`. Reorder the generated statements if needed.*

- [ ] **Step 5: Verify types.** `npx tsc --noEmit` in `be/`. Fix any code that read `instructors.bio`/`instructors.phone` (grep for them) to read from `staff_users` instead. Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add be/src/db/schema/identity.ts be/src/db/schema/catalog.ts be/src/db/migrations
git commit -m "feat(be): staff profile fields on staff_users + backfill from name/instructors"
```

### Task 3: Name split/join helper + self-check

**Files:**
- Create: `be/src/lib/name.ts`, `be/src/lib/name.test.ts`

**Interfaces:**
- Produces: `splitName(full: string): { firstName: string; lastName: string | null }`, `joinName(firstName: string, lastName?: string | null): string`.

- [ ] **Step 1: Write the helper** `be/src/lib/name.ts`:

```ts
export function splitName(full: string): { firstName: string; lastName: string | null } {
  const trimmed = full.trim().replace(/\s+/g, ' ')
  if (!trimmed) return { firstName: '', lastName: null }
  const i = trimmed.indexOf(' ')
  if (i === -1) return { firstName: trimmed, lastName: null }
  return { firstName: trimmed.slice(0, i), lastName: trimmed.slice(i + 1) }
}

export function joinName(firstName: string, lastName?: string | null): string {
  return [firstName.trim(), (lastName ?? '').trim()].filter(Boolean).join(' ')
}
```

- [ ] **Step 2: Write the self-check** `be/src/lib/name.test.ts` (assert-based, no framework — runnable via `npx tsx`):

```ts
import assert from 'node:assert'
import { splitName, joinName } from './name'

assert.deepStrictEqual(splitName('Anya'), { firstName: 'Anya', lastName: null })
assert.deepStrictEqual(splitName('Anya Sharma'), { firstName: 'Anya', lastName: 'Sharma' })
assert.deepStrictEqual(splitName('Anya Devi Sharma'), { firstName: 'Anya', lastName: 'Devi Sharma' })
assert.deepStrictEqual(splitName('  Anya   Sharma  '), { firstName: 'Anya', lastName: 'Sharma' })
assert.strictEqual(joinName('Anya', 'Sharma'), 'Anya Sharma')
assert.strictEqual(joinName('Anya', null), 'Anya')
assert.strictEqual(joinName('Anya', ''), 'Anya')
console.log('name.test ok')
```

- [ ] **Step 3: Run it.** `npx tsx be/src/lib/name.test.ts`. Expected: `name.test ok` (exit 0).

- [ ] **Step 4: Commit.**

```bash
git add be/src/lib/name.ts be/src/lib/name.test.ts
git commit -m "feat(be): name split/join helper with self-check"
```

---

## Phase 2 — Backend services & routes

### Task 4: Payroll pay-per-instructor union

**Files:**
- Modify: the payroll service under `be/src/services/` (grep `instructorPaySgd` / `payroll` to locate) and `be/src/routes/portal/admin/payroll.ts`

**Interfaces:**
- Consumes: `classSupportingInstructors.paySgd`, `workshopInstructors.paySgd`, `ptSessionSupportingInstructors.paySgd`, existing `classes.instructorPaySgd`, `ptSessions.instructorPaySgd`.
- Produces: payroll rows keyed by `instructorId` summing pay across all sources; PATCH that sets pay on a specific instructor row.

- [ ] **Step 1: Locate current payroll aggregation.** Grep `be/src/services` for the query summing `instructorPaySgd`. Read it fully before editing.

- [ ] **Step 2: Extend the aggregation** to `UNION ALL` these pay sources, grouped by instructor:
  - main class pay: `classes.mainInstructorId`, `classes.instructorPaySgd`
  - supporting class pay: `classSupportingInstructors.instructorId`, `.paySgd`
  - main PT pay: `ptSessions.instructorId`, `ptSessions.instructorPaySgd`
  - supporting PT pay: `ptSessionSupportingInstructors.instructorId`, `.paySgd`
  - workshop pay: `workshopInstructors.instructorId`, `.paySgd`
  Treat NULL pay as unpriced (exclude from totals, surface as "unpriced" count if the existing UI shows that — match current behavior).

- [ ] **Step 3: Update payroll PATCH** (`payroll.ts` → service) so `{ instructor_pay_sgd }` can target a specific `(session, instructor)` pair: for a supporting instructor it writes the join row's `paySgd`; for the main instructor it writes the parent `instructorPaySgd`; for a workshop instructor it writes `workshopInstructors.paySgd`. Zod: add optional `instructor_id` to the PATCH body; when present, resolve which row to update.

- [ ] **Step 4: Verify.** `npx tsc --noEmit` in `be/`. Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add be/src/services be/src/routes/portal/admin/payroll.ts
git commit -m "feat(be): payroll sums pay per instructor across class/PT/workshop"
```

### Task 5: PT session PATCH (edit + multi-instructor)

**Files:**
- Modify: `be/src/services/` PT session service (grep the service backing `POST /pt-sessions/:id/schedule`) — add `updatePtSession()`
- Modify: `be/src/routes/portal/admin/pt-sessions.ts` — add `PATCH /:id`

**Interfaces:**
- Consumes: `ptSessionSupportingInstructors` (Task 1).
- Produces: `PATCH /portal/admin/pt-sessions/:id` accepting `{ starts_at?, ends_at?, room_id?, location_id?, session_type?, instructor_id?, instructor_pay_sgd?, supporting_instructors?: { instructor_id, pay_sgd? }[], ... }`.

- [ ] **Step 1: Read the class PATCH** in `be/src/routes/portal/admin/schedule.ts` (`PATCH /classes/:id`) and its service. Mirror its shape/validation/guards for PT (e.g. can't edit a cancelled session; timing sanity).

- [ ] **Step 2: Add `updatePtSession(id, patch)` to the PT service** — patch scalar fields on `pt_sessions`; for `supporting_instructors`, replace the `pt_session_supporting_instructors` rows for that session (delete-then-insert inside the existing transaction helper the service uses). Reject if a supporting instructor duplicates the main `instructor_id`.

- [ ] **Step 3: Add the route** `PATCH /:id` in `pt-sessions.ts`: `auth → zod parse → updatePtSession → format`. No logic in the route.

- [ ] **Step 4: Verify.** `npx tsc --noEmit` in `be/`. Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add be/src/services be/src/routes/portal/admin/pt-sessions.ts
git commit -m "feat(be): PATCH pt-sessions/:id for edit + multi-instructor"
```

### Task 6: Staff profile create/update + supporting-instructor pay in existing PATCHes

**Files:**
- Modify: `be/src/routes/portal/admin/staff.ts` (+ its service) — extend invite payload, add `PATCH /:id`
- Modify: `be/src/routes/portal/admin/schedule.ts` (`PATCH /classes/:id`) & `workshops.ts` — accept `pay_sgd` per supporting/workshop instructor

**Interfaces:**
- Produces: `PATCH /portal/admin/staff/:id` accepting `{ first_name?, last_name?, phone?, address?, gender?, bio?, languages?, role?, granted_location_ids? }`; class/workshop instructor patches carry per-instructor `pay_sgd`.

- [ ] **Step 1: Extend the staff service** to write the new profile fields on create/invite AND on update, keeping `name` in sync via `joinName(firstName, lastName)` (import from `src/lib/name.ts`). Grep the invite service for where `name` is set today.

- [ ] **Step 2: Add `PATCH /:id`** to `staff.ts`: `auth (superadmin-gated, same guard as archive) → zod parse → updateStaffProfile → format`. Reuse the superadmin/self guards already in the archive path so role/profile edits respect them.

- [ ] **Step 3: Extend class & workshop instructor patches.** In `PATCH /classes/:id` change `supporting_instructor_ids: string[]` to accept `supporting_instructors: { instructor_id, pay_sgd? }[]` (keep back-compat: also accept the bare id array and default pay to null). In workshops' instructor patch, accept `pay_sgd` per `workshop_instructors` row. Push the write into the existing service, not the route.

- [ ] **Step 4: Verify.** `npx tsc --noEmit` in `be/`. Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add be/src/routes/portal/admin be/src/services
git commit -m "feat(be): staff profile PATCH + per-instructor pay in class/workshop patches"
```

---

## Phase 3 — fe-portal edit UIs

> FE pattern: the api client is `api.patch(path, body)` / `api.post` / `api.del` (see existing `ClassInstructorEditor` in `[type]/[id]/page.tsx` for the exact import + usage). Reuse existing shadcn `Dialog`/`Input`/`Select`/form components already in the portal — do not add libraries.

### Task 7: Class full edit form

**Files:**
- Modify: `fe-portal/src/app/admin/schedule/[type]/[id]/page.tsx` (`ClassDetail`)

- [ ] **Step 1: Read `ClassDetail` + `ClassInstructorEditor`** in that file to copy the existing PATCH call pattern and the read-only `DetailField`s for timing/room/type.

- [ ] **Step 2: Add an edit form/dialog** that PATCHes `/portal/admin/schedule/classes/:id` with `starts_at`, `ends_at`, `room_id`, `location_id`, `class_type_id`, plus the existing instructor fields now carrying per-instructor `pay_sgd` (new `supporting_instructors` shape from Task 6). Reuse the room/type/instructor option sources the create form (`admin/schedule/new/class/page.tsx`) already fetches.

- [ ] **Step 3: Verify.** In `fe-portal/`: `npx tsc --noEmit` && `npm run build`. Expected: both pass.

- [ ] **Step 4: Commit.**

```bash
git add fe-portal/src/app/admin/schedule/"[type]"/"[id]"/page.tsx
git commit -m "feat(portal): edit class timing/room/type/instructors after scheduling"
```

### Task 8: Workshop day/tier edit

**Files:**
- Modify: `fe-portal/src/components/workshops/workshop-editor.tsx` (stub at ~line 353)

- [ ] **Step 1: Read the editor** to see how days/tiers are POSTed on create and where the `"Editing days/tiers ships in v1"` toast lives.

- [ ] **Step 2: Wire edit** — for existing days call `PATCH /portal/admin/schedule/workshops/:id/days/:dayId` (starts/ends/room/capacity/price), for existing tiers the tier PATCH; keep POST for newly-added rows and DELETE for removed ones. Add per-instructor `pay_sgd` inputs to the workshop instructor section (writes via the workshop instructor patch from Task 6). Remove the stub toast.

- [ ] **Step 3: Verify.** `npx tsc --noEmit` && `npm run build` in `fe-portal/`. Expected: both pass.

- [ ] **Step 4: Commit.**

```bash
git add fe-portal/src/components/workshops/workshop-editor.tsx
git commit -m "feat(portal): edit workshop days/tiers after creation"
```

### Task 9: PT cancel + edit UI

**Files:**
- Modify: `fe-portal/src/app/admin/schedule/[type]/[id]/page.tsx` (`PtDetail`)

- [ ] **Step 1: Read `PtDetail`** (currently read-only) and the class `handleCancelClass` pattern to copy the confirm-dialog + `api.post` cancel flow.

- [ ] **Step 2: Add a Cancel button** wired to the existing `POST /portal/admin/pt-sessions/:id/cancel` (confirm dialog, mirror `handleCancelClass`).

- [ ] **Step 3: Add an edit dialog** PATCHing the new `/portal/admin/pt-sessions/:id` (Task 5): timing, room, location, `session_type`, main `instructor_id` + `instructor_pay_sgd`, and `supporting_instructors[]` with per-person pay. Reuse the room/instructor option sources.

- [ ] **Step 4: Verify.** `npx tsc --noEmit` && `npm run build` in `fe-portal/`. Expected: both pass.

- [ ] **Step 5: Commit.**

```bash
git add fe-portal/src/app/admin/schedule/"[type]"/"[id]"/page.tsx
git commit -m "feat(portal): cancel + edit PT sessions incl. multiple instructors"
```

### Task 10: Staff profile edit form

**Files:**
- Modify: `fe-portal/src/app/admin/staff/page.tsx`
- Create: `fe-portal/src/components/staff/staff-edit-dialog.tsx`

- [ ] **Step 1: Read `staff/page.tsx`** (`StaffRow`, the invite flow, the api client usage) to copy patterns.

- [ ] **Step 2: Build `staff-edit-dialog.tsx`** — a form with: first name, last name, email (read-only if email isn't editable server-side — confirm in Task 6), phone, address, gender (`Select` from `female/male/non_binary/prefer_not_to_say`), bio (`Textarea`), languages (tag input — reuse any existing multi-value input in the portal; else a comma-separated `Input` split to `string[]`). PATCHes `/portal/admin/staff/:id`.

- [ ] **Step 3: Add an Edit action to `StaffRow`** opening the dialog (superadmin-gated, matching the page's existing gate).

- [ ] **Step 4: Verify.** `npx tsc --noEmit` && `npm run build` in `fe-portal/`. Expected: both pass.

- [ ] **Step 5: Commit.**

```bash
git add fe-portal/src/app/admin/staff/page.tsx fe-portal/src/components/staff/staff-edit-dialog.tsx
git commit -m "feat(portal): edit staff profile (name, contact, gender, bio, languages)"
```

---

## Phase 4 — End-to-end verification

### Task 11: Dogfood pass

- [ ] **Step 1:** Bring up local stack (client 3000 / portal 3001 / BE 4000 / PG 5432) and run migration + seed per `dogfood_local_qa` setup.
- [ ] **Step 2:** Via the `dogfood` skill (agent-browser, NOT Playwright): as admin — edit a class (change timing, room, type; confirm persisted); edit a workshop day; schedule a PT session, add a second instructor with different pay each, edit it, then cancel it; edit a staff profile setting all 8 fields.
- [ ] **Step 3:** Open payroll and confirm each instructor's total reflects their own per-session pay (main + supporting + workshop), and unpriced rows still surface as before.
- [ ] **Step 4:** If anything fails, fix at root cause (shared service, not the calling screen) and re-verify.

---

## Self-Review

- **Spec coverage:** F1 per-instructor pay → Tasks 1,4,6; F2 staff profiles → Tasks 2,3,6,10; F3 editable + PT multi-instructor → Tasks 1,5,7,8,9; F4 deactivation → already built (no task, by design). Covered.
- **Placeholders:** none — each step names exact files/columns/endpoints; code shown where code changes.
- **Type consistency:** `splitName`/`joinName` names match across Tasks 3 & 6; `paySgd` column name consistent across Tasks 1,4,6; `supporting_instructors: { instructor_id, pay_sgd? }[]` shape consistent across Tasks 5,6,7,9; `ptSessionSupportingInstructors` consistent Tasks 1,5.
- **Known unknowns the executor resolves by reading first (flagged in-step):** exact numeric precision on `instructorPaySgd`; exact FK/onDelete conventions on `class_supporting_instructors`; current payroll aggregation location; whether email is server-editable. Each task's Step 1 says to read the real code before writing.
