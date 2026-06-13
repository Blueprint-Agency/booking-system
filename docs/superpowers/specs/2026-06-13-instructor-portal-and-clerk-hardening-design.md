# Instructor Portal View + Clerk Invitation Hardening — Design

**Date:** 2026-06-13
**Apps touched:** `fe-portal/` (instructor UI), `be/` (instructor routes + Clerk flow)
**Decisions locked (2026-06-13):** separate `/instructor/*` route tree · instructors can create classes + schedule PT · full best-practice Clerk pass.

---

## 1. Problem

The portal serves three roles — `superadmin`, `admin`, `instructor` — but the **instructor view does not exist**. The role is present in types, Clerk auth, the BE role gate, and `staff_users.role`, yet:

- `fe-portal` has **no** `/instructor/*` routes. The whole app is `/admin/*`, and `admin-nav.tsx:217-221` never branches on `role === "instructor"`, so an instructor logs in to an empty shell.
- An instructor also can't get a workspace at all: `workspace-context.tsx:174-179` filters locations by `grantedLocationIds` for every non-superadmin, but instructors carry empty grants → **zero** accessible locations.
- BE instructor routes are half-built: `/portal/instructor/pt-requests` (list/schedule/cancel) is implemented and already forces `instructor_id = self`; `/schedule`, `/schedule/today`, `/roster`, `/check-in`, `/profile` are `501` stubs. There is **no** instructor class-create route and **no** instructor-scoped payroll route.

Separately, the **Clerk staff invitation flow has best-practice gaps**: `staff_invitations.token` and `expires_at` are written at invite time but never read — linking is purely email-based, so an **expired invitation still activates an account**, and the auto-link fallback in middleware swallows failures with a `console.warn`.

## 2. Goals

1. An invited instructor can sign in and reach a dedicated instructor surface.
2. Instructor can **schedule/create class sessions** and **schedule/cancel PT requests** — but can **never** choose the instructor (always themselves) or enter a pay amount (always left `null`/empty).
3. Instructor sees a **Payroll** view scoped to **their own** sessions only — never other instructors'.
4. Instructor gets a minimal **Profile** (view identity, edit bio/phone) — completing the existing stub.
5. **Clerk invitation flow** follows best practice: token + expiry are honored, accept/pending transitions are correct, the auto-link fallback is diagnosable, and auth/role data is never served stale from browser cache; sign-out fully clears local state.

### Non-goals (deferred, explicitly out of scope this pass)

- **Check-in / session roster / QR scan** for instructors (`/portal/instructor/check-in`, `/roster` stay 501). These depend on the booking-QR PNG path that is 501 project-wide; pull in later as its own task.
- **Instructor photo upload** (needs R2, which is deferred project-wide). Profile edits bio + phone only; photo is a noted TODO.
- Any change to refunds, invoices, dashboard, marketing.
- Supporting-instructor selection by an instructor (an instructor creates a class with main = self and **no** supporting instructors; admins keep the full picker).

## 3. Architecture

### 3a. Separate `/instructor/*` tree (FE)

A new route group `fe-portal/src/app/instructor/*` with its own layout, shell, and nav. Instructor pages **only** call `/portal/instructor/*` endpoints — they physically cannot hit an admin endpoint or render an instructor-picker/pay field. This is the security boundary the locked decision chose.

Shared backbone is reused, not duplicated:

- **`WorkspaceProvider`** is reused as the auth/api/location backbone. One correctness fix lands here (see 3c): align the FE "accessible locations" rule to the BE — `superadmin` **or empty grants** ⇒ all active locations. This unblocks instructors (and is simply more correct).
- Shared UI (`components/ui`, `components/schedule/capacity-fields`, `lib/formatters`, `lib/api`) is reused.

New FE files:

```
src/app/instructor/layout.tsx              # WorkspaceProvider + InstructorShell; redirect admins → /admin
src/app/instructor/schedule/page.tsx       # "My schedule" agenda (own classes + PT), today + upcoming/past
src/app/instructor/schedule/new/class/page.tsx  # create class: no instructor picker, no pay field
src/app/instructor/pt-requests/page.tsx    # pending PT queue → pick up + schedule (location/room/time)
src/app/instructor/payroll/page.tsx        # own completed sessions + own monthly total (read-only)
src/app/instructor/profile/page.tsx        # identity (read) + bio/phone (edit)
src/components/layout/instructor-shell.tsx # nav + topbar wrapper (mirrors AdminShell)
src/components/layout/instructor-nav.tsx   # instructor-only nav items
```

**Role-aware landing (UX, not a security boundary — BE role gates are the boundary):** role is only known after `/portal/auth/me` (it is not in the Clerk token), so redirects are client-side in the layouts:

- `/admin/layout.tsx`: once loaded, if `role === "instructor"` → `router.replace("/instructor/schedule")`.
- `/instructor/layout.tsx`: if `role === "admin" | "superadmin"` → `router.replace("/admin/schedule")`.
- Post-login home stays `/admin/schedule`; an instructor landing there bounces to `/instructor/schedule`.

The instructor topbar reuses the location switcher (an instructor needs to pick a location when scheduling) and the existing user/sign-out menu.

### 3b. Instructor BE surface

Mounted under the existing `routes/portal/instructor/` router (already gated `requireRole('instructor','admin','superadmin')` + `requireActiveStaff` + audit). The acting instructor is always `c.get('staffUserId')`.

| Method | Path | Service reused | Notes |
|---|---|---|---|
| GET | `/portal/instructor/schedule` | `schedule/timetable.listSchedule({ instructorId: self, from?, to? })` | own classes + PT; replaces the 501 stub |
| GET | `/portal/instructor/schedule/today` | same, today's SGT range | replaces 501 stub |
| POST | `/portal/instructor/schedule/classes` | `schedule/classes.createClass` | **forces** `mainInstructorId = self`, `supportingInstructorIds = []`, `instructorPaySgd = null`, `createdByStaffId = self`. Body: class_type_id, location_id, room_id, starts_at, ends_at, capacities, credit_cost. **No** instructor or pay fields accepted. |
| GET | `/portal/instructor/pt-requests` | (existing) `listPtRequestsForAdmin({status:'pending'})` | unchanged |
| POST | `/portal/instructor/pt-requests/:id/schedule` | (existing) `schedulePtRequest` | unchanged — already forces `instructorId = self` |
| POST | `/portal/instructor/pt-requests/:id/cancel` | (existing) `cancelPtRequest` | unchanged |
| GET | `/portal/instructor/payroll` | `payroll/list.listPayroll({ instructorId: self, from?, to?, class_type_id? })` | `instructorId` is **forced** to self, ignoring any query param. Returns own rows + own total. **No PATCH** (instructors can't edit pay). |
| GET | `/portal/instructor/profile` | new thin read | `instructors` row + name/email/role from `staff_users` |
| PATCH | `/portal/instructor/profile` | new thin write | bio, phone only (photo = TODO/R2-deferred) |
| GET | `/portal/instructor/catalog/class-types` | existing class-types service | read for the class-create form (admin catalog endpoints are admin-gated) |
| GET | `/portal/instructor/catalog/rooms` | existing rooms service | read for class-create + PT scheduling |

Locations for the forms come from `/portal/auth/me` (already returns them). Class-type/room reads are added under the instructor router so the instructor surface never calls `/portal/admin/*`.

### 3c. The `accessibleLocations` fix

`workspace-context.tsx`:

```ts
// before: non-superadmin always filtered by grants → instructors get []
if (currentStaff.role === "superadmin") return active;
return active.filter(l => currentStaff.grantedLocationIds.includes(l.id));

// after: empty grants = all active (matches BE /auth/me semantics)
if (currentStaff.role === "superadmin" || currentStaff.grantedLocationIds.length === 0)
  return active;
return active.filter(l => currentStaff.grantedLocationIds.includes(l.id));
```

This is correct for both roles: the BE already returns "all active locations" for empty grants, so the FE was diverging.

## 4. Clerk invitation / accept-pending / cache hardening

Current flow: `inviteAdmin` writes `staff_users(status='pending')` + `staff_invitations(token, expires_at=now+7d)` and emails `…/signup?invite_email=<email>`. The Clerk `<SignUp/>` finalizes, Clerk fires `user.created` → `syncStaffFromClerk` matches **by email**, sets `status='active'`, marks the invitation `accepted`. The token and `expires_at` are never consulted.

### 4a. Honor token + expiry (BE)

- `buildSignUpUrl(email, token)` → `…/signup?invite_email=<email>&invite_token=<token>`. (`resendInvitation` keeps the same token; it already extends `expires_at`.)
- **New public endpoint** `GET /api/v1/public/staff-invitation?token=…` (unauthed, under `routes/public/`): returns `{ status: 'valid'|'expired'|'used'|'revoked'|'not_found', email, role }`. Expiry is **computed from `expires_at`, not persisted** — the row stays `pending`, so the endpoint is read-only and the invite remains visible/resendable. The signup page uses this to render the right state and confirm the invited email.
- **`syncStaffFromClerk` gains an invitation-validity gate** before activating a `pending` row:
  - Look up the matching `staff_invitations` row by `staff_user_id` (status `pending`).
  - If none exists (seeded superadmin / legacy `createInstructor` instructor) → activate, as before.
  - If it exists and **is not past `expires_at`** → activate and mark `accepted`.
  - If it exists and **is past `expires_at`** → **do not** link/activate and **do not** mutate the invite; return new outcome `{ kind: 'invite_expired' }`. The staff row + invite both stay `pending`, so `requireActiveStaff` keeps returning 403 — an expired invite cannot grant access.
  - Recovery: admin clicks **Resend** (the invite is still `pending`, so it's listed and `resendInvitation` accepts it) → `expires_at` extended; the next login re-runs the gate via the middleware auto-link fallback (row still unlinked), which now passes and activates. No new Clerk user needed.

### 4b. Diagnosable auto-link fallback (BE)

`clerkStaffAuth`'s fallback (when no `staff_users` row matches the Clerk `sub`) calls `syncStaffFromClerk` and currently swallows failures. Change: surface the sync outcome in the 403 body — `{ error: 'staff_not_provisioned', reason: 'invite_expired' | 'no_staff_row' | 'email_mismatch' }` — and `console.error` (not `warn`) on unexpected outcomes, so a stuck invite is diagnosable from the response and logs.

### 4c. Browser caching / cookies (FE)

- **`lib/api.ts`**: add `cache: "no-store"` to the fetch — this is an authenticated API client; auth/role responses must never be served from the bfcache/HTTP cache. (Role is already re-fetched fresh on every mount via `/auth/me`; this closes the transport-cache gap.)
- **Sign-out clears local state**: the `ys.activeLocationId` localStorage key currently survives sign-out, so the next user on the same browser can inherit a stale active location. Clear it in both sign-out paths — `dev-role-switcher.tsx` (manual) and `workspace-context.tsx` (auto sign-out on 401/403). Clerk's own httpOnly session cookie is cleared by `signOut()`.
- Role is **not** cached client-side anywhere (confirmed) — no change needed there; documented so it isn't "fixed" by accident.

## 5. Data flow (instructor schedules a class)

1. Instructor opens `/instructor/schedule/new/class`. Form loads class-types + rooms from `/portal/instructor/catalog/*`; locations from `/portal/auth/me` (via `WorkspaceProvider`). **No** instructor field, **no** pay field rendered.
2. Submit → `POST /portal/instructor/schedule/classes` with class_type/location/room/time/capacity/credit_cost.
3. Route forces `mainInstructorId = staffUserId`, `supportingInstructorIds = []`, `instructorPaySgd = null`, then calls `createClass` (which asserts room-in-location + room-availability, same as admin).
4. Class appears on the instructor's `/instructor/schedule` and on the admin timetable; pay shows `null` ("unpriced") in admin Payroll, editable by admin later — exactly the existing admin affordance.

## 6. Error handling

- Reuse existing service errors: room conflict `409`, room/location mismatch `400`, bad time range `400`; the instructor forms render the same copy as the admin class form.
- `requireActiveStaff` already returns `403 staff_inactive` for pending/archived — the instructor surface relies on this; no instructor page renders for a non-active user (the shell shows the loading/empty state and `WorkspaceProvider` signs out on 401/403).
- Invitation endpoint returns structured `status` rather than throwing for expired/used, so the signup page renders a friendly message instead of an error boundary.

## 7. Testing / verification

No BE test infra (per project conventions) — verify BE with `npx tsc --noEmit` in `be/`. Verify FE with `tsc --noEmit` + `next build` in `fe-portal/` (lint is known-broken). Manual dogfood via the `dogfood` skill:

1. Invite an instructor (admin) → sign up via the emailed link → land on `/instructor/schedule`.
2. Create a class as the instructor → confirm no instructor/pay fields, class appears on own schedule + admin timetable as unpriced.
3. Pick up + schedule a PT request as the instructor → confirm it's assigned to self.
4. Open instructor Payroll → see only own sessions.
5. Expired-invite path: sign-up against an expired token is refused (stays pending / 403); resend → succeeds.
6. Sign out → `ys.activeLocationId` cleared; signing in as a different role lands on the correct tree.

## 8. Env / deploy impact

None. No new env vars (reuses `PORTAL_ORIGIN`, existing Clerk secrets). No schema migration (all columns already exist and are nullable where needed). `deploy-be.yml` and `.env.example` unchanged.
