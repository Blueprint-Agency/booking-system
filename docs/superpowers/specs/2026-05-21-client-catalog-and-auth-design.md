# fe-client: catalog surfacing + auth wiring — design

**Date:** 2026-05-21
**Status:** approved for planning
**Scope decision:** read-only surfacing (no booking/checkout writes); Clerk built-in password reset; add fe-client middleware; public class schedule; account pages stay on mock this pass.

## Problem

The client app must surface everything admins configure in fe-portal — classes (following the schedule), workshops, PT, and packages — and have a coherent login/signup/password-reset experience with Clerk wired correctly.

Audit findings:

| Domain | BE read | fe-client | Verdict |
|---|---|---|---|
| Workshops | implemented (`/public/catalog/workshops`, `/me/catalog/workshops`) | wired live | done — verify only |
| Packages (class + PT) | implemented (`/public/catalog/packages`, `/me/catalog/class-packages`, `/me/catalog/pt-packages`) | wired live | mostly done — verify; paid checkout out of scope |
| Classes / schedule | **stubbed 501** (`/public/catalog/classes`, `/me/catalog/classes`) | mock `sessions.json` | **main gap** |
| PT availability | **stubbed 501** (`/me/catalog/instructors/:id/availability`) | mock slots | gap (read display in scope; submit out) |
| Locations | **stubbed 501** (`/public/catalog/locations`) | — | needed for class filters |
| Auth | Clerk webhook sync works; BE sends no auth emails | `<SignIn>`/`<SignUp>` work; `/forgot-password` + `/reset-password` are dead shells; no `middleware.ts` | gap |

## Out of scope (explicit)

Booking writes (`POST /me/bookings/class`, PT request submit), Stripe checkout / Payment Intents, refunds, and the stubbed `/me/me` profile + dashboard + `/me/bookings/*` reads. These stay at 501. Account pages (`/account/*`) stay on mock-state this pass. Class "Book" and PT "Request" buttons remain wired to the still-stubbed write endpoints and are clearly non-functional.

## Part 1 — Classes following schedule

### Approach
Add a dedicated client serializer in a new `be/src/services/schedule/client-catalog.ts` (mirrors `services/workshops/catalog.ts`). It reuses the *query shape* of the classes branch of `listSchedule()` (`timetable.ts`) — same `lifecycle='active'` filter, same confirmed-booking count — but selects the fields the client needs that `listSchedule` does NOT expose: `credit_cost` and `capacity_online` specifically (the bookable-online cap), not the sum of all three capacities. Mount prefixes are `/api/v1/public/*` and `/api/v1/me/*` (no `/catalog` path segment). The `classes` table has NO difficulty/level column, so neither the payload nor the client UI carries a level field.

### BE endpoints (replace 501 stubs)

> Path note: actual mount prefixes are `/api/v1/public/*` and `/api/v1/me/*` — the routers mount `catalog` at `/`, so there is **no** `/catalog` path segment. Paths below should read `/public/classes`, `/public/classes/:id`, `/public/locations`, `/me/classes`, `/me/instructors/:id/availability`. Testing uses `tsc`/build + manual curl against the seeded dev DB (the BE has no test runner; we are not adding one for read-only endpoints this pass).

- `GET /public/catalog/classes` — zod query: `location_id?`, `instructor_id?`, `class_type_id?`, `from?` (ISO date), `to?` (ISO date). Default window today → +28 days; cap range at 90 days. Returns active (`lifecycle='active'`) instances in window. Per instance:
  `id, class_type {id, name}, instructor {id, name}, location {id, name}, room {id, name} | null, starts_at, ends_at, credit_cost, capacity_online, booked_count, spots_left, lifecycle` (NO difficulty/level — not in the `classes` schema).
- `GET /public/catalog/classes/:id` — single instance; adds `class_type.description`, `location.address`, `location.gmaps_url`. 404 if not found or cancelled.
- `GET /me/catalog/classes` — identical to public **plus** `is_booked: boolean` per instance for the signed-in client (left-join their confirmed `bookings` on `class_id`). Honors `include_my_bookings` semantics by always including it.
- `GET /public/catalog/locations` — list active locations (`id, name, address, gmaps_url, phone`). Drives the timetable location filter.
- `GET /me/catalog/instructors/:id/availability` — enumerate active `ptSessions` for the instructor from now → now + `book_in_advance_days` (from `pt_booking_config`), each with `starts_at, ends_at, session_type, spots_left`. **Read-only display.**

Serializer helpers live in a new `be/src/services/schedule/client-catalog.ts` (mirrors `services/workshops/catalog.ts`). Routes stay thin: auth → zod parse → call service → format.

### fe-client
- New `src/lib/classes.ts` mirroring `src/lib/workshops.ts`: `ApiClassCard`, `ApiClassDetail`, `ApiLocationLite`, `useClasses(filters)` hook (public when signed out, `/me/...` when signed in), `useLocations()`.
- `/classes` page: remove `sessions.json` + mock-state reads; keep the existing calendar/filter UI but DROP the "level" filter (no difficulty in schema); keep instructor, location, date filters and feed them live data. Signed-in users see `is_booked` badges. "Book" button calls the still-stubbed `POST /me/bookings/class` (out of scope; surfaced as disabled/"coming soon" affordance to avoid a broken click).
- `/private-sessions`: rewire instructor + location lists and the availability picker to live BE (`/public/catalog/locations`, `/me/catalog/instructors/:id/availability`); the request-submit path stays stubbed.

### Visibility
Class schedule is **public** (signed-out visitors browse via `/public/catalog/classes`). `/classes` is NOT added to the protected matcher. Booking requires login.

## Part 2 — Verify workshops & packages
No rebuild. Correctness pass on the already-wired pages: promotions + early-bird pricing render, trial-pass one-per-client enforcement reflected in UI, class/PT package entitlements display for signed-in users. Fix discrepancies only.

## Part 3 — Auth UX + Clerk

### Password reset
Delete `fe-client/src/app/(client)/forgot-password/` and `.../reset-password/` (dead shells, no wiring). Clerk's `<SignIn>` component already provides hosted password reset (email + verification code) — that becomes the single reset path, consistent with login/signup which are already Clerk components.

### Middleware
Add `fe-client/src/middleware.ts` using `clerkMiddleware` + `createRouteMatcher`. Protected: `/account(.*)`, `/checkout`. Signed-out access redirects to `/login?next=<original-path>`. Public: `/`, `/classes`, `/workshops(.*)`, `/packages`, `/pricing`, `/private-sessions(.*)`, auth routes. Include the standard Clerk Next.js `config.matcher`.

### Coherence checks
- `ClerkProvider` props in `layout.tsx` (`signInUrl="/login"`, `signUpUrl="/register"`, fallback redirects) consistent with the new middleware redirect target.
- `<SignIn>`/`<SignUp>` `forceRedirectUrl` honors `?next=`.
- `/verify-email` flow aligns with Clerk email verification and the BE `requireVerified` gate (booking writes require verified email+phone — documented, not built this pass).

### Email / reset-link wiring (documentation, not code)
The BE sends **no** auth emails — Clerk hosts signup verification and password-reset-code emails. So "when emails get sent" is a Clerk **dashboard** configuration concern. The spec documents the required client Clerk app settings:
- Email verification (code) enabled at sign-up.
- Password reset via email code enabled.
- Allowed redirect/host URLs include the fe-client origin.
- Email templates (verification, reset) reviewed in Clerk dashboard.

No env-var changes (Clerk client keys already present per CLAUDE.md). No `deploy-be.yml` changes (no new BE env).

## Testing
- BE: unit/integration test the class catalog serializer (window default, filters, booked_count, is_booked for signed-in) and locations + PT availability against seeded data.
- fe-client: manual verification that `/classes`, `/workshops`, `/packages`, `/private-sessions` render live data signed-out and signed-in; middleware redirects `/account` when signed out; Clerk reset flow reachable from `<SignIn>`.

## Files touched (anticipated)
- BE: `routes/public/catalog.ts`, `routes/client/catalog.ts`, new `services/schedule/client-catalog.ts`, possibly small additions to `services/schedule/timetable.ts`.
- fe-client: new `src/lib/classes.ts`, new `src/middleware.ts`, `app/(client)/classes/page.tsx`, `app/(client)/private-sessions/*`, delete `forgot-password/` + `reset-password/`; verify-only on workshops/packages pages.
