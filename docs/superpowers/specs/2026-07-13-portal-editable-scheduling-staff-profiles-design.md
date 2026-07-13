# Portal: editable scheduling, per-instructor pay, multi-instructor, staff profiles

**Date:** 2026-07-13
**Status:** Approved design — ready for implementation plan
**Apps touched:** `be/`, `fe-portal/`

## Context

The staff portal can *create* scheduled classes/PT/workshops but can't fully *edit* them after the fact, staff accounts carry almost no profile data, instructor pay is a single per-session number (not tied to a named instructor), and PT sessions are single-instructor only. This spec covers four related gaps. Deactivating staff is **already built** (`archiveStaff`/`unarchiveStaff`/`softDeleteStaff`, `staff_status` enum, superadmin guards, FE buttons) and is out of scope.

Current instructor-assignment model (keep it):
- `classes`: `mainInstructorId` FK + `class_supporting_instructors` join (0..N).
- `workshops`: M:N `workshop_instructors` join with `workshop_instructor_role` enum (`main`/`supporting`).
- `pt_sessions`: single `instructorId` FK only.
- All instructor FKs point to `instructors.staffUserId`.

---

## Feature 1 — Per-instructor pay

**Problem:** pay is one number per session (`classes.instructorPaySgd`, `pt_sessions.instructorPaySgd`); workshops have no pay column. It can't be attributed to a specific instructor when a session has more than one.

**Design:** attach pay to each instructor's assignment row; keep the existing main+supporting shape (no ripping out `mainInstructorId`).

Schema:
- `class_supporting_instructors`: add `pay_sgd numeric` (nullable = unpriced). Main instructor's pay stays on `classes.instructorPaySgd`.
- `workshop_instructors`: add `pay_sgd numeric` (nullable). This is workshops' **first** pay data.
- PT: new join `pt_session_supporting_instructors (pt_session_id, instructor_id, pay_sgd)` — see Feature 3. Main pay stays on `pt_sessions.instructorPaySgd`.

Payroll service change: the per-session pay sum becomes a union of `{main pay on parent}` + `{supporting-join pay}` + `{workshop-join pay}`, grouped by instructor. Workshops become a new payroll source. Payroll PATCH (`/portal/admin/payroll/:kind/:id`) must be able to set pay on a specific instructor's row, not just the session.

*Rationale:* reuses existing join tables and main FKs — smallest change that ties a pay amount to a named instructor.

---

## Feature 2 — Staff profile fields

**Problem:** `staff_users` has only combined `name` + `email`. Bio/phone live on `instructors` only (not admins). No edit UI — profile is set once at invite.

**Design:** put the shared profile on `staff_users` so admins *and* instructors both have it.

Schema (`staff_users`):
- `first_name text`, `last_name text` — split. Backfill from existing `name` (first token → first_name, remainder → last_name). Keep `name` populated as `first_name + ' ' + last_name` on write so existing display code keeps working. *(ponytail: avoids touching every `name` reader.)*
- `phone text`
- `address text`
- `gender client_gender` — reuse the existing `client_gender` enum (`female`/`male`/`non_binary`/`prefer_not_to_say`); do not mint a new one.
- `bio text`
- `languages text[]` — free tags (default `'{}'`).
- `email` already exists.

Migration: move existing `instructors.bio` / `instructors.phone` values up into `staff_users`, then drop those two columns from `instructors`. `instructors` keeps `photoR2Key` + class relations.

Endpoints: extend the invite/create payload to accept the new fields, and add an **update-profile** endpoint (`PATCH /portal/admin/staff/:id`) covering the profile fields (name/role/location grants also become editable here). Required: first_name, last_name, email. Everything else optional.

FE: an edit-profile form/dialog on `fe-portal/src/app/admin/staff/page.tsx` (`StaffRow` gets an edit action). Instructors additionally edit bio/phone/photo here (moved from wherever instructor-only, if anywhere).

---

## Feature 3 — Editable after scheduling + PT multi-instructor

### Classes (backend ready — FE only)
`PATCH /portal/admin/schedule/classes/:id` already patches timing/room/type/instructors/capacity/pay. FE `ClassDetail` (`fe-portal/src/app/admin/schedule/[type]/[id]/page.tsx`) currently edits **instructor only** and renders timing/room/type read-only. Wire a full edit form to the existing PATCH. Include supporting-instructor pay (Feature 1).

### Workshops (backend ready — FE only)
Day/tier edit endpoints exist (`PATCH /workshops/:id/days/:dayId`, tier PATCH). `workshop-editor.tsx:353` stubs it (`"Editing days/tiers ships in v1"`). Finish the stub: edit existing days/tiers via PATCH instead of only POST-on-create. Include per-instructor `pay_sgd` (Feature 1).

### PT (backend + FE)
- New `pt_session_supporting_instructors (pt_session_id, instructor_id, pay_sgd)` join → PT multi-instructor. `pt_sessions.instructorId` stays as main.
- New `PATCH /portal/admin/pt-sessions/:id` — edit timing/room/sessionType/main+supporting instructors/pay/capacity, mirroring the class PATCH. (`POST /pt-sessions/:id/cancel` already exists.)
- FE `PtDetail` (same `[type]/[id]/page.tsx`) is fully read-only today: add a **cancel** button (wire existing endpoint) and an **edit** dialog (wire new PATCH).

---

## Feature 4 — Deactivate staff

**Already implemented.** No work. Documented here so it isn't re-scoped: `be/src/services/auth/staff-archive.ts` + `be/src/routes/portal/admin/staff.ts` + `fe-portal/src/app/admin/staff/page.tsx` (archive/unarchive/delete buttons). Superadmin is protected via `isSeededSuperadminEmail()` and role guards.

---

## Cross-cutting

- **Migrations:** one Drizzle migration adds all new columns/tables and does the two backfills (name split, instructor bio/phone → staff_users). Single migration history, PR-reviewed per project convention.
- **No business logic in routes:** all mutations go through `services/*` (new pay-per-instructor logic lives in the payroll/scheduling services so admin and client paths can't drift).
- **Env:** no new env vars.

## Testing

No BE test framework in this repo — verify with `npx tsc --noEmit` in `be/` and `fe-portal/`, plus `next build` for the portal. Manual dogfood pass via the `dogfood` skill: edit a class (timing/room/type), edit a workshop day, schedule + edit + cancel a PT session with two instructors and different pay each, confirm payroll sums per instructor, and edit a staff profile (all 8 fields).

Runnable check for the one piece of non-trivial pure logic — the `name` split/join backfill — as a small assert-based self-check.

## Open defaults (proceed unless redirected)
1. `languages` = free-tag `text[]` (not a fixed picklist).
2. `name` split into first/last, combined `name` kept in sync on write.
