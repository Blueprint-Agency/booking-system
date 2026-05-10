# Backend Architecture — Yoga Sadhana

Companion to `admin-restructure.md` (admin) and `fe-client-features.md` (client). The single backend serves **both** `fe-admin` and `fe-client` over `/api/admin/*` and `/api/client/*` route groups. `admin-restructure.md` is the source of truth for behaviour; this doc is the structural mapping into Node + Postgres.

---

## 1. Stack

| Concern | Pick |
|---|---|
| HTTP framework | **Hono** + `@hono/zod-validator` |
| ORM | **Drizzle** (pg dialect, `postgres-js` driver) |
| Database | **Postgres** |
| Validation | **Zod** |
| Auth | **Clerk** — two applications: client app + staff app (per §15b session isolation) |
| File storage | **Cloudflare R2** (S3-compatible via `@aws-sdk/client-s3` + presigned uploads) |
| Background jobs | **BullMQ** (Redis-backed; separate worker process) |
| Email | **Resend** (transactional, 21 templates per §17) |
| Payments | **Stripe** (Payment Intents + Refund API; no Subscriptions in v1) |

---

## 2. Folder Structure

```
be/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── .env.example
└── src/
    ├── index.ts                       # HTTP server entry
    ├── app.ts                         # Hono instance + global middleware + route mounting
    ├── env.ts                         # Zod-validated env vars (loaded once)
    │
    ├── db/
    │   ├── client.ts                  # Drizzle + postgres-js connection (singleton)
    │   ├── enums.ts                   # pgEnum definitions (one place for all enums)
    │   ├── schema/
    │   │   ├── index.ts               # Re-exports tables
    │   │   ├── identity.ts            # clients, staff_users, staff_invitations
    │   │   ├── catalog.ts             # locations, class_types, instructors, instructor_class_types
    │   │   ├── policy.ts              # global_policy, pt_booking_config (singletons)
    │   │   ├── packages.ts            # class_packages, pt_packages, client_packages
    │   │   ├── schedule.ts            # classes, workshops, workshop_tiers, workshop_images,
    │   │   │                          #   workshop_instructors, pt_sessions, pt_session_clients
    │   │   ├── availability.ts        # instructor_availability_recurring, _oneoff
    │   │   ├── bookings.ts            # bookings, cancellations, check_ins
    │   │   ├── ratings.ts             # ratings
    │   │   ├── ledger.ts              # manual_adjustments, audit_log, stripe_payments
    │   │   ├── content.ts             # email_templates, email_log, waiver, waiver_signatures
    │   │   ├── inbox.ts               # inbox_items
    │   │   └── relations.ts           # All Drizzle `relations()` declarations
    │   ├── seed/
    │   │   ├── run.ts                 # Orchestrator (idempotent)
    │   │   ├── superadmin.ts          # Bootstrap initial superadmin from SUPERADMIN_EMAIL env
    │   │   ├── email-templates.ts     # Seed 21 default templates per §17b
    │   │   ├── waiver.ts              # Seed placeholder waiver body per §18a
    │   │   └── policy.ts              # Seed defaults: global_policy, pt_booking_config
    │   └── migrations/                # drizzle-kit-generated SQL
    │
    ├── modules/                       # Feature modules — see §3 for shape
    │   ├── locations/
    │   │   ├── routes.admin.ts        # /api/admin/locations — CRUD + archive/restore
    │   │   ├── service.ts
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── class-types/
    │   │   ├── routes.admin.ts
    │   │   ├── service.ts
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── instructors/
    │   │   ├── routes.admin.ts        # /api/admin/instructors — CRUD + archive/restore + invite
    │   │   ├── routes.client.ts       # /api/client/instructors — browse + detail (for PT picker)
    │   │   ├── service.ts
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── policy/
    │   │   ├── routes.admin.ts        # /api/admin/policy — read + update (singletons)
    │   │   ├── service.ts
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── class-packages/
    │   │   ├── routes.admin.ts        # CRUD on catalogue (§5)
    │   │   ├── routes.client.ts       # Read-only browse + initiate Stripe purchase
    │   │   ├── service.ts
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── pt-packages/
    │   │   ├── routes.admin.ts        # CRUD (§6)
    │   │   ├── routes.client.ts       # Browse + buy
    │   │   ├── service.ts
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── schedule/                  # Class instances + workshop instances (§7)
    │   │   ├── routes.admin.ts        # Class CRUD, workshop CRUD, admin-cancel
    │   │   ├── routes.client.ts       # Read-only timetable + filters (§7a)
    │   │   ├── routes.instructor.ts   # Own schedule view (next phase, stub now)
    │   │   ├── service.ts
    │   │   ├── workshops.service.ts   # Workshop-specific (tiers, images, capacity)
    │   │   ├── classes.service.ts     # Class-instance-specific
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── pt-sessions/                # PT request flow (§9)
    │   │   ├── routes.admin.ts        # Approve / decline / cancel
    │   │   ├── routes.client.ts       # Submit request + view own + cancel
    │   │   ├── routes.instructor.ts   # Approve / decline (own only)
    │   │   ├── service.ts
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── availability/               # §8
    │   │   ├── routes.admin.ts        # CRUD on behalf of instructors
    │   │   ├── routes.client.ts       # Read free slots for selected instructor
    │   │   ├── routes.instructor.ts   # Own availability (next phase)
    │   │   ├── service.ts
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── bookings/                   # Class & workshop client booking
    │   │   ├── routes.admin.ts        # Read rosters
    │   │   ├── routes.client.ts       # Book class, buy workshop, cancel own, view own
    │   │   ├── service.ts             # Calls lib/policy.ts for cap+window evaluation
    │   │   ├── cancel.service.ts      # Cancel flow (client + admin paths)
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── check-in/                   # §11
    │   │   ├── routes.admin.ts        # /api/admin/check-in (generic page) + per-session
    │   │   ├── routes.instructor.ts   # Same surface, scoped to own
    │   │   ├── service.ts
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── ratings/                    # §14
    │   │   ├── routes.admin.ts        # Read all (full attribution)
    │   │   ├── routes.client.ts       # Submit + edit own + read attended
    │   │   ├── routes.instructor.ts   # Read own (anonymised in service.ts)
    │   │   ├── service.ts             # Includes view-scoping anonymisation
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── clients/                    # §16
    │   │   ├── routes.admin.ts        # List, profile, status toggle, adjustments
    │   │   ├── routes.self.ts         # /api/client/me — own profile, packages, history
    │   │   ├── service.ts
    │   │   ├── adjustments.service.ts # Manual credit/session adjust (§16d)
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── staff/                      # §15
    │   │   ├── routes.admin.ts        # List, invite, revoke, archive, resend invite
    │   │   ├── service.ts
    │   │   ├── invitations.service.ts # Token issue + Clerk invitation API call
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── inbox/                      # §13
    │   │   ├── routes.admin.ts        # /api/admin/inbox — list, mark read, approve/decline PT
    │   │   ├── routes.instructor.ts   # PT requests for own sessions
    │   │   ├── service.ts
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── notifications/              # §17 — template management + send orchestration
    │   │   ├── routes.admin.ts        # Template CRUD
    │   │   ├── service.ts
    │   │   ├── send.ts                # `enqueueEmail(slug, recipient, vars)` — used by all modules
    │   │   ├── render.ts              # Variable substitution + sanitisation
    │   │   ├── variables.ts           # Allowed variables per template slug (validation source)
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   ├── waiver/                     # §18
    │   │   ├── routes.admin.ts        # Edit waiver text + signed count
    │   │   ├── routes.client.ts       # Read for registration sign
    │   │   ├── service.ts
    │   │   ├── schemas.ts
    │   │   └── types.ts
    │   └── billing/                    # Stripe orchestration
    │       ├── routes.client.ts       # Create payment intent (package or workshop)
    │       ├── service.ts             # Stripe SDK wrappers
    │       ├── grants.ts              # On payment success: grant package row or workshop booking
    │       ├── refunds.ts             # Workshop admin-cancel: fan out refunds
    │       ├── schemas.ts
    │       └── types.ts
    │
    ├── middleware/
    │   ├── clerk-client.ts            # Verify client Clerk JWT → load `clients` row → ctx.client
    │   ├── clerk-staff.ts             # Verify staff Clerk JWT → load `staff_users` row → ctx.staff
    │   ├── require-role.ts            # Factory: `requireRole('admin' | 'superadmin' | 'instructor')`
    │   ├── require-active.ts          # Block suspended clients / archived staff
    │   ├── audit.ts                   # Auto-write audit_log on mutating staff requests
    │   ├── error.ts                   # AppError → HTTP mapping
    │   └── request-id.ts              # Trace ID per request
    │
    ├── lib/
    │   ├── clerk.ts                   # Two Clerk SDK instances (client + staff app keys)
    │   ├── stripe.ts                  # Stripe SDK + signed webhook verification
    │   ├── r2.ts                      # S3 client + presigned URL helpers
    │   ├── resend.ts                  # Resend client + send wrapper
    │   ├── policy.ts                  # `evaluateCancellation(client, kind, sessionStartsAt, now)` (§4)
    │   ├── codes.ts                   # `generateBookingCodes()` → { qrToken, code: 'YS-A4F2K9' }
    │   ├── time.ts                    # SGT (`Asia/Singapore`) conversions
    │   ├── event-state.ts             # `computeEventState({ starts_at, ends_at, lifecycle, now })`
    │   │                              #   → 'scheduled' | 'ongoing' | 'completed' | 'cancelled'
    │   ├── richtext.ts                # Sanitise/render rich text bodies (waiver, workshop description, email)
    │   └── capacity.ts                # `getBookedCount(classId | workshopTierId)` query helpers
    │
    ├── jobs/
    │   ├── queues.ts                  # BullMQ queue instances + connection
    │   ├── worker.ts                  # Worker process entry (separate from HTTP)
    │   ├── handlers/
    │   │   ├── send-email.ts          # Render via notifications/render.ts → Resend → log
    │   │   ├── checkin-nag.ts         # Daily — sessions ended 24h ago with `pending` check-in
    │   │   ├── credit-expiry.ts       # Daily — client_packages expiring in 7 days
    │   │   └── stripe-refund.ts       # Per-booking refund on workshop admin-cancel (§7a)
    │   └── schedulers/
    │       └── daily.ts               # Cron entry (e.g. 03:00 SGT) → enqueue daily handlers
    │
    ├── webhooks/
    │   ├── clerk.ts                   # user.created → upsert; user.updated → sync; session.revoked
    │   ├── stripe.ts                  # payment_intent.succeeded → grant; charge.refunded → mark
    │   └── resend.ts                  # bounce / complaint logging (optional)
    │
    └── shared/
        ├── errors.ts                  # AppError, NotFoundError, ConflictError, ForbiddenError
        ├── http.ts                    # Hono response helpers (`ok`, `created`, etc.)
        └── types.ts                   # Shared TS types (Hono context augmentation)
```

**Run topology:** two long-lived Node processes — HTTP (`src/index.ts`) and BullMQ worker (`src/jobs/worker.ts`). Both import the same Drizzle client and `lib/`. No shared in-memory state.

---

## 3. Module Shape & Routing

Every feature module follows the same shape:

```
modules/<feature>/
├── routes.admin.ts        # Mounted under /api/admin/<feature>
├── routes.client.ts       # Mounted under /api/client/<feature>  (where applicable)
├── routes.instructor.ts   # Mounted under /api/admin/<feature> with require-role('instructor')
├── service.ts             # Business logic — only layer that touches `db`
├── schemas.ts             # Zod request + response schemas
└── types.ts               # Inferred Drizzle types + DTOs
```

### Top-level mount

```ts
// app.ts
app.route('/api/client',   clientApi)   // requires clerk-client + require-active
app.route('/api/admin',    adminApi)    // requires clerk-staff + require-role('admin'|'superadmin'|'instructor')
app.route('/api/webhooks', webhookApi)  // public, signed
app.route('/api/public',   publicApi)   // truly public (invite token validation, etc.)
```

### Who hits which routes

| Module | `/api/client` | `/api/admin` (admin/superadmin) | `/api/admin` (instructor scope) |
|---|---|---|---|
| locations | — | CRUD | — |
| class-types | — | CRUD | — |
| instructors | browse + PT picker | CRUD + invite + archive | — |
| policy | — | read + update | — |
| class-packages | browse + buy | CRUD | — |
| pt-packages | browse + buy | CRUD | — |
| schedule | timetable + class detail | class & workshop CRUD + admin-cancel | own schedule view |
| pt-sessions | submit + view own + cancel | approve/decline + cancel | approve/decline (own) + cancel (own) |
| availability | read free slots | CRUD on behalf of instructor | own availability (next phase) |
| bookings | book + cancel + view own | rosters | rosters (own) |
| check-in | — | QR + code + manual | QR + code + manual (own) |
| ratings | submit + edit own + read attended | read all (with attribution) | read own (anonymised) |
| clients | `/me` profile | list + profile + status + adjustments | — |
| staff | — | list + invite + archive | — |
| inbox | — | full | PT requests for own sessions |
| notifications | — | template CRUD | — |
| waiver | read for sign | edit + signed count | — |
| billing | initiate Stripe checkout | — | — |

---

## 4. Database Schema

All tables use `id uuid primary key default gen_random_uuid()` unless noted. Timestamps are `timestamptz`. Soft delete is a nullable `archived_at`. Money is `numeric(10, 2)` SGD. All FKs `on delete restrict` (we soft-delete) unless noted.

### 4a. Identity

#### `clients`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| clerk_user_id | text | unique, not null — from client Clerk app |
| email | text | unique, not null |
| name | text | not null |
| phone | text | not null |
| status | enum `client_status` | not null, default `'active'` — values: `active`, `suspended` |
| suspended_at | timestamptz | nullable |
| referred_by_client_id | uuid | FK → clients.id, nullable, on delete set null (self-FK) |
| joined_at | timestamptz | not null, default now() |
| created_at, updated_at | timestamptz | not null, default now() |

**Indexes:** `(clerk_user_id) unique`, `(email) unique`, `(status)`, `(referred_by_client_id)`, `(lower(name))` for case-insensitive search.

#### `staff_users`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| clerk_user_id | text | unique, nullable — null until invite accepted |
| email | text | unique, not null |
| name | text | not null |
| role | enum `staff_role` | not null — `superadmin`, `admin`, `instructor` |
| status | enum `staff_status` | not null, default `'pending'` — `pending`, `active`, `archived` |
| archived_at | timestamptz | nullable |
| archived_by_staff_id | uuid | FK → staff_users.id, nullable |
| invited_at, accepted_at | timestamptz | nullable |
| created_at, updated_at | timestamptz | not null, default now() |

**Indexes:** `(clerk_user_id) unique`, `(email) unique`, `(role, status)`.

**Hard delete: never** (per §15c). Archive only. Email uniqueness enforces "one email = one staff account."

#### `staff_invitations`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| email | text | not null |
| role | enum `staff_role` | not null — `admin` or `instructor` (not `superadmin`) |
| token | text | unique, not null — opaque random string |
| expires_at | timestamptz | not null — issuance + 7 days (§15b) |
| status | enum `invitation_status` | not null, default `'pending'` — `pending`, `accepted`, `revoked`, `expired` |
| invited_by_staff_id | uuid | FK → staff_users.id, not null |
| staff_user_id | uuid | FK → staff_users.id, nullable — set on accept |
| created_at, accepted_at, revoked_at | timestamptz | |

**Indexes:** `(token) unique`, `(email, status)`, `(invited_by_staff_id)`.

### 4b. Catalog

#### `locations`

id, name (text, not null), address (text), gmaps_url (text), phone (text), archived_at (nullable).
**Indexes:** `(archived_at)`.

#### `class_types`

id, name (text, not null), archived_at (nullable).
**Indexes:** `(archived_at)`, `(lower(name))` for search.

#### `instructors` — 1:1 extension of staff_users where role=instructor

| Column | Type | Constraints |
|---|---|---|
| staff_user_id | uuid | PK + FK → staff_users.id, on delete cascade |
| photo_r2_key | text | nullable |
| bio | text | nullable |
| phone | text | nullable — overrides staff_users.phone if needed (admin doc §3 lists this) |

#### `instructor_class_types` — M:N eligibility (§3)

| Column | Type | Constraints |
|---|---|---|
| instructor_id | uuid | FK → instructors.staff_user_id, on delete cascade |
| class_type_id | uuid | FK → class_types.id, on delete restrict |
| **PK** (instructor_id, class_type_id) |

### 4c. Policy (singletons)

Both tables enforce single row at app layer. We use `id uuid PK` plus a `CHECK` that pins to a known sentinel value.

#### `global_policy` (§4)

cancel_cap_count int, cancel_cap_cycle_days int, class_window_hours int, pt_window_hours int, updated_at, updated_by_staff_id (FK).

#### `pt_booking_config` (§6)

book_in_advance_days int, updated_at, updated_by_staff_id (FK).

### 4d. Packages

#### `class_packages` (admin catalogue per §5)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| name | text | not null |
| kind | enum `class_package_kind` | `credit_bundle`, `unlimited` |
| credits | int | nullable — required when kind=`credit_bundle` (CHECK constraint) |
| validity_days | int | nullable — required when kind=`credit_bundle` |
| duration_days | int | nullable — required when kind=`unlimited` |
| price_sgd | numeric(10, 2) | not null |
| status | enum `package_status` | `active`, `archived` |
| archived_at | timestamptz | nullable |

**Indexes:** `(status, kind)`.
**CHECK:** kind-specific column requirements (Postgres CHECK constraint, kept simple).

#### `pt_packages` (§6)

id, name, session_type enum (`1on1`, `2on1`), num_sessions int, price_sgd, status, archived_at.

#### `client_packages` (per-client purchased instances — the actual entitlement ledger)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| client_id | uuid | FK → clients.id |
| kind | enum `client_package_kind` | `credit_bundle`, `unlimited`, `pt` |
| source_class_package_id | uuid | FK → class_packages.id, nullable (set when kind in {credit_bundle, unlimited}) |
| source_pt_package_id | uuid | FK → pt_packages.id, nullable (set when kind=`pt`) |
| credits_or_sessions_remaining | int | nullable — null when kind=`unlimited` |
| expires_at | timestamptz | nullable — set for credit_bundle + unlimited; null for pt |
| purchased_at | timestamptz | not null |
| amount_paid_sgd | numeric(10, 2) | not null |
| stripe_payment_intent_id | text | unique, not null |

**Indexes:** `(client_id, kind)`, `(client_id, expires_at)` for upcoming-expiry sweep, `(stripe_payment_intent_id) unique`.

### 4e. Schedule

**Lifecycle vs. event state.** Per §11, event state (`scheduled` → `ongoing` → `completed`) is time-derived. Admin-cancel is the only persisted state change. We therefore store only `lifecycle` (`active` / `cancelled`) on each schedule entity and **compute** event state at read time via `lib/event-state.ts`. This guarantees the timetable reflects reality immediately rather than waiting for a cron.

```
lifecycle = 'cancelled'                        → 'cancelled'
lifecycle = 'active' AND now < starts_at       → 'scheduled'
lifecycle = 'active' AND starts_at ≤ now ≤ ends_at → 'ongoing'
lifecycle = 'active' AND now > ends_at         → 'completed'
```

#### `classes` (class instances, §7b)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| class_type_id | uuid | FK → class_types.id |
| instructor_id | uuid | FK → instructors.staff_user_id |
| location_id | uuid | FK → locations.id |
| starts_at | timestamptz | not null |
| ends_at | timestamptz | not null, CHECK ends_at > starts_at |
| capacity | int | not null, CHECK > 0 |
| credit_cost | int | not null, CHECK ≥ 0 |
| lifecycle | enum `lifecycle` | not null, default `'active'` — `active`, `cancelled` |
| cancelled_at | timestamptz | nullable |
| cancelled_by_staff_id | uuid | FK → staff_users.id, nullable |
| created_at | timestamptz | not null |
| created_by_staff_id | uuid | FK → staff_users.id |

**Indexes:** `(starts_at)` for timetable range queries, `(instructor_id, starts_at)`, `(location_id, starts_at)`, `(class_type_id)`, `(lifecycle, starts_at)`.

#### `workshops` (§7c)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| name | text | not null |
| class_type_id | uuid | FK → class_types.id |
| cover_r2_key | text | nullable |
| description_html | text | rich text, sanitised on write |
| location_id | uuid | FK → locations.id |
| starts_at | timestamptz | not null |
| ends_at | timestamptz | not null, CHECK > starts_at |
| lifecycle | enum `lifecycle` | not null, default `'active'` |
| cancelled_at, cancelled_by_staff_id | | nullable |
| created_at, created_by_staff_id | | not null |

**Indexes:** `(starts_at)`, `(lifecycle, starts_at)`.

#### `workshop_images` — additional images per §7c

id, workshop_id (FK, on delete cascade), r2_key, ord (int).

#### `workshop_instructors` (M:N — §7c "Instructor(s) (multi-select)")

workshop_id, instructor_id, **PK** pair, both FKs, on delete cascade.

#### `workshop_tiers` (§7c)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| workshop_id | uuid | FK, on delete cascade |
| name | text | not null |
| description | text | |
| regular_price_sgd | numeric(10, 2) | not null |
| early_bird_price_sgd | numeric(10, 2) | nullable |
| early_bird_quota | int | nullable |
| early_bird_cutoff_at | timestamptz | nullable |
| capacity | int | not null, CHECK > 0 |
| ord | int | not null — for display order |

**Indexes:** `(workshop_id, ord)`.

#### `pt_sessions` (one row per request, §9)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| instructor_id | uuid | FK → instructors.staff_user_id |
| location_id | uuid | FK → locations.id, nullable until confirmed |
| starts_at, ends_at | timestamptz | not null, CHECK ends_at > starts_at |
| session_type | enum `pt_session_type` | `1on1`, `2on1` |
| status | enum `pt_session_status` | `pending`, `confirmed`, `declined`, `cancelled` |
| decline_note | text | nullable, required when status=`declined` (app layer) |
| confirmed_at, confirmed_by_staff_id | | nullable |
| declined_at, declined_by_staff_id | | nullable |
| cancelled_at, cancelled_by_staff_id | | nullable |
| created_at | timestamptz | not null |

Lifecycle here is conflated with status because PT requests have a richer state machine (pending/declined are not just "scheduled" or "cancelled"). Event state computation is gated on `status='confirmed'`.

**Indexes:** `(instructor_id, starts_at)`, `(status, starts_at)`.

#### `pt_session_clients` (M:N — supports 2-on-1)

pt_session_id, client_id, **PK** pair, FKs, on delete cascade.

### 4f. Availability (§8)

#### `instructor_availability_recurring`

id, instructor_id (FK), weekday (int 0–6), start_time (`time`), end_time (`time`).
**Indexes:** `(instructor_id, weekday)`.

#### `instructor_availability_oneoff`

id, instructor_id (FK), starts_at, ends_at.
**Indexes:** `(instructor_id, starts_at)`.

### 4g. Bookings, Cancellations, Check-ins

#### `bookings` — polymorphic (class | workshop | pt)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| client_id | uuid | FK → clients.id |
| kind | enum `booking_kind` | `class`, `workshop`, `pt` |
| class_id | uuid | FK → classes.id, nullable — set when kind=`class` |
| workshop_id | uuid | FK → workshops.id, nullable — set when kind=`workshop` |
| workshop_tier_id | uuid | FK → workshop_tiers.id, nullable — set when kind=`workshop` |
| pt_session_id | uuid | FK → pt_sessions.id, nullable — set when kind=`pt` |
| client_package_id | uuid | FK → client_packages.id, nullable — null for workshops (paid via Stripe directly) |
| state | enum `booking_state` | `confirmed`, `cancelled`, `no_show` |
| credits_or_sessions_used | int | nullable — null for workshops + unlimited |
| refund_outcome | enum `refund_outcome` | `credit_returned`, `session_returned`, `stripe_refunded`, `forfeited`, `n_a` |
| check_in_state | enum `checkin_state` | `pending`, `attended`, `no_show`, `n_a` (workshops) |
| qr_token | text | unique, not null — encoded into QR |
| code | text | unique, not null — `YS-A4F2K9`, case-insensitive lookup via stored uppercase + index |
| stripe_payment_intent_id | text | unique, nullable — for workshops |
| booked_at | timestamptz | not null |
| cancelled_at | timestamptz | nullable |

**CHECK constraints (kind-specific FK presence):**
- kind=`class` → class_id NOT NULL, workshop_id NULL, pt_session_id NULL
- kind=`workshop` → workshop_id NOT NULL, workshop_tier_id NOT NULL, class_id NULL, pt_session_id NULL
- kind=`pt` → pt_session_id NOT NULL, class_id NULL, workshop_id NULL

**Indexes:**
- `(client_id, booked_at desc)` for "view own bookings"
- `(class_id, state)` for class roster + capacity count
- `(workshop_tier_id, state)` for tier capacity count
- `(pt_session_id)` unique partial where kind=`pt` (one booking per PT session for 1-on-1; for 2-on-1 multiple bookings tied via pt_session_clients)
- `(qr_token) unique`, `(code) unique`
- `(check_in_state)` for "pending check-in" surfacing (§11)
- `(stripe_payment_intent_id) unique where not null`

#### `cancellations` (drives §4 cap calculation)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| booking_id | uuid | FK → bookings.id |
| client_id | uuid | FK → clients.id (denormalised for query) |
| kind | enum | `class`, `pt` (workshops not represented; admin-cancel still logged but excluded) |
| source | enum | `client`, `admin` — `admin` cancellations don't count toward cap |
| was_within_window, was_within_cap, refund_fired | boolean | not null |
| cancelled_at | timestamptz | not null |

**Indexes:** `(client_id, cancelled_at)` — primary query is "count where source='client' AND cancelled_at >= cycle_anchor."

#### `check_ins`

id, booking_id (FK), checked_in_at, checked_in_by_staff_id (FK), method enum (`qr`, `code`, `manual`).
**Indexes:** `(booking_id) unique` — at most one check-in per booking.

### 4h. Ratings (§14)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| booking_id | uuid | FK → bookings.id, unique — one rating per attended booking |
| client_id | uuid | FK |
| kind | enum | `class`, `workshop` (PT not rateable in v1) |
| class_id, workshop_id | uuid | nullable — exactly one set per kind |
| instructor_id | uuid | FK — denormalised for instructor profile aggregates |
| stars | int | CHECK 1 ≤ stars ≤ 5 |
| comment | text | nullable |
| rated_at | timestamptz | not null |
| edited_at | timestamptz | nullable |
| edit_window_closes_at | timestamptz | not null — rated_at + 7 days |

**Indexes:** `(class_id) where kind='class'`, `(workshop_id) where kind='workshop'`, `(instructor_id, rated_at desc)`.

### 4i. Ledger

#### `manual_adjustments` (§16d)

id, client_id (FK), client_package_id (FK), delta (int, signed), reason (text, not null), acted_by_staff_id (FK), created_at.
**Indexes:** `(client_id, created_at desc)`, `(client_package_id)`.

**App-level invariant:** rejecting adjustment if it would drive `client_packages.credits_or_sessions_remaining` below zero. Enforced in service layer + DB trigger as defence-in-depth.

#### `audit_log`

id, actor_staff_id (FK, nullable for system events), actor_type enum (`staff`, `system`), action text (e.g. `class.cancelled`, `client.suspended`, `staff.archived`), target_table text, target_id uuid, payload jsonb, created_at.
**Indexes:** `(target_table, target_id, created_at desc)`, `(actor_staff_id, created_at desc)`, `(action, created_at desc)`.

UI surfacing is next phase (§19) but the table is populated this phase.

#### `stripe_payments`

id, payment_intent_id (text unique), amount_sgd, kind enum (`workshop`, `class_package`, `pt_package`), client_id (FK), booking_id (FK, nullable), client_package_id (FK, nullable), status enum (`pending`, `succeeded`, `refunded`, `failed`), refunded_at (nullable), created_at.

**Indexes:** `(payment_intent_id) unique`, `(client_id, created_at desc)`.

### 4j. Content

#### `email_templates` (§17)

id, slug (text unique — e.g. `class_booking_confirmed`, 21 seeded values), subject (text), body_html (text), updated_at, updated_by_staff_id (FK).

**Slug list (21):**
```
welcome
password_reset
class_booking_confirmed
pt_request_submitted
pt_session_approved
pt_session_declined
workshop_purchase_confirmed
class_cancelled_credit_returned
class_cancelled_forfeited
pt_cancelled_session_returned
pt_cancelled_forfeited
admin_cancel_class
admin_cancel_pt
admin_cancel_workshop
rating_prompt_class
rating_prompt_workshop
package_purchase_confirmed
credit_expiry_reminder
instructor_invite
admin_invite
checkin_nag
```

#### `email_log`

id, template_slug (text), recipient_email (text), recipient_user_id (uuid, nullable), recipient_user_kind enum (`client`, `staff`), subject_rendered (text), body_rendered (text), status enum (`queued`, `sent`, `failed`), resend_id (text, nullable), error (text, nullable), queued_at, sent_at.

**Indexes:** `(recipient_user_id, queued_at desc)`, `(status)`, `(template_slug, queued_at desc)`.

#### `waiver` (singleton — §18)

id, body_html (text), updated_at, updated_by_staff_id (FK).

#### `waiver_signatures`

id, client_id (FK, **unique** — one signature per client), signed_at.

### 4k. Inbox (§13)

#### `inbox_items`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| type | enum | `client_cancellation`, `admin_cancel_class_pt`, `admin_cancel_workshop`, `pt_request` |
| payload | jsonb | denormalised display data — keys vary by type, validated by Zod at insert time |
| source_pt_session_id | uuid | FK, nullable — set for type=`pt_request` (the actionable row) |
| read_at, read_by_staff_id | | nullable |
| action_taken | enum | `approved`, `declined`, nullable — set on PT request resolution |
| action_at, action_by_staff_id | | nullable |
| created_at | timestamptz | not null |

**Indexes:** `(type, read_at, created_at desc)` for filter + unread count, `(source_pt_session_id) where type='pt_request'`.

**Payload schemas (Zod, validated at write):**
- `client_cancellation` → `{ client_id, client_name, session_kind, session_id, session_label, cancelled_at, refund_result }`
- `admin_cancel_class_pt` → `{ actor_staff_id, actor_name, session_kind, session_id, session_label, cancelled_at, clients_refunded }`
- `admin_cancel_workshop` → `{ actor_staff_id, actor_name, workshop_id, workshop_name, cancelled_at, total_refunded_sgd, attendees_refunded }`
- `pt_request` → `{ client_id, client_name, instructor_id, instructor_name, requested_starts_at, requested_ends_at, message }`

---

## 5. Background Jobs (BullMQ)

| Queue | Trigger | Handler |
|---|---|---|
| `email` | Any module via `notifications/send.ts:enqueueEmail()` | Render template + variables → Resend → write `email_log` |
| `checkin-nag` | Daily cron 03:00 SGT | Find sessions where `ends_at` between now-25h and now-23h AND any booking has `check_in_state='pending'` → enqueue `email` to assigned instructor (cc admin), one per session |
| `credit-expiry` | Daily cron 03:00 SGT | Find `client_packages` where `expires_at` between now+6.5d and now+7.5d → enqueue `email` (`credit_expiry_reminder`) |
| `stripe-refund` | Workshop admin-cancel route | For each booking in workshop: call Stripe Refund API → on success, update booking `state='cancelled'`, `refund_outcome='stripe_refunded'`; emit inbox item once for the workshop |

**No `flip-event-state` job.** Event state is computed at read time by `lib/event-state.ts`.
**No `cycle-reset` job.** Cancellation cap is computed dynamically in `lib/policy.ts` from `cancellations` table filtered by `cancelled_at >= now() - cycle_days`.

Idempotency keys on `stripe-refund` jobs (booking_id) prevent double refund on retry.

---

## 6. External Integrations

### 6a. Clerk

- **Two applications.** Separate publishable + secret keys, separate JWT issuers, separate user pools — enforces §15b "staff and client spaces are independent."
- **Middleware split.** `/api/client/*` uses `clerk-client.ts`; `/api/admin/*` uses `clerk-staff.ts`. Each verifies its own JWT issuer; cross-app tokens are rejected.
- **Identity glue.** Our DB stores `clerk_user_id` on `clients` and `staff_users`. Clerk owns auth state (password, sessions, MFA); we own profile + role + relationships.
- **`user.created` webhook** upserts the `clients` (or `staff_users`) row on first sign-in. For staff, it pairs with a pending `staff_invitations` row by email.
- **Profile edits** flow through Clerk (name, password). `user.updated` webhook syncs name/email back to our row.
- **Force-logout on archive** (§15c) — admin-archive route calls Clerk's `revokeAllSessions(userId)` API.
- **Staff invitations.** We own the `staff_invitations` row (token, role, audit). Clerk's invitation API handles email + accept-link UX. On accept, the webhook fires and we link `clerk_user_id` to the matching `staff_users.id`.

### 6b. Stripe

- **Payment Intents only** in v1 (no Checkout Sessions, no Subscriptions). Backend creates intent → returns `client_secret` → fe confirms with Stripe.js.
- **`payment_intent.succeeded` webhook** → `billing/grants.ts`:
  - kind=`class_package` or `pt_package` → insert `client_packages` row
  - kind=`workshop` → insert `bookings` row (workshop_id + workshop_tier_id + state=`confirmed`)
  - Always insert `stripe_payments` row with `status='succeeded'`
- **Workshop admin-cancel** (§7a) → enqueue one `stripe-refund` job per booking in workshop. Worker calls Stripe Refund API. `charge.refunded` webhook closes the loop.
- **Idempotency.** Stripe's event IDs are deduplicated against `stripe_payments.payment_intent_id` (and a separate `stripe_webhook_events` table for raw event de-dupe — minor, can add later).

### 6c. Cloudflare R2

- S3-compatible. `@aws-sdk/client-s3` with R2 endpoint and credentials.
- **Buckets:** `yoga-sadhana-public` (workshop covers, instructor photos — served via R2 public URL); `yoga-sadhana-private` (reserved, unused in v1).
- **Upload flow:** backend issues presigned PUT URL with content-type and 5 MB cap → fe uploads directly → fe POSTs the returned key back to backend, backend stores in `instructors.photo_r2_key` / `workshops.cover_r2_key` / `workshop_images.r2_key`.

### 6d. Resend

- Single sending domain. Server-side rendering via `notifications/render.ts`:
  - Parse template body for `{{variable}}` tokens
  - Validate against `notifications/variables.ts` allow-list per slug (this is what powers the §17c amber flag in fe — same source of truth)
  - Substitute values; sanitise (XSS safe — rich text from admin trusted, but variables themselves escaped)
- One `email_log` row per recipient per send.

---

## 7. Cross-Cutting

### Cancellation evaluation (§4)

`lib/policy.ts:evaluateCancellation()` — pure function:

```
input:  { clientId, kind: 'class' | 'pt', sessionStartsAt, now }
reads:  cancellations (count where client_id=X AND source='client' AND cancelled_at >= now - cycle_days),
        global_policy
output: { allowed: true,            // always true per §4
          refund: 'full' | 'forfeit',
          reason: 'within_window_within_cap' | 'over_cap' | 'late' | 'late_and_over_cap' }
```

Used by `bookings/cancel.service.ts` (client path). Admin path bypasses this — always full refund.

### Audit middleware

Mounted on `/api/admin/*` with method in `(POST, PUT, PATCH, DELETE)`. Captures `(actor_staff_id, action_inferred_from_route, target_table, target_id, payload)` and inserts into `audit_log` after the route handler succeeds. Service layer can also write directly for cron / webhook events (`actor_type='system'`).

### Event state (§11)

`lib/event-state.ts` — pure function over `(starts_at, ends_at, lifecycle, now)`. Called by every read endpoint that returns schedule entities. The fe never persists this; backend never stores this.

### Per-booking codes (§11)

On booking creation, `lib/codes.ts:generateBookingCodes()` returns:
- `qr_token` — 32-byte URL-safe random; encoded into QR, not human-readable
- `code` — 6-char alphanumeric, prefixed `YS-`, uniqueness enforced via DB unique index. Stored uppercase; lookup is case-insensitive by uppercasing input.

Both index into `bookings` directly — no "wrong session" possible.

### Capacity enforcement

- **Class:** booked count = `count(bookings WHERE class_id = X AND state = 'confirmed')`. Enforced at book-time (service-layer transaction with `SELECT ... FOR UPDATE` on the class row).
- **Workshop tier:** booked count = `count(bookings WHERE workshop_tier_id = X AND state = 'confirmed')`. Same lock pattern on tier row.

### Timezone

All timestamps stored UTC. `lib/time.ts` exposes SGT (`Asia/Singapore`) helpers for: cycle anchors, day-boundary edge cases (e.g. "7 days before expiry" calculated in SGT), schedule cron timing.

### Migrations

`drizzle-kit generate` → SQL committed to `db/migrations/` → `drizzle-kit migrate` on deploy. Schema-additive only by default. Destructive changes (drops, type narrowing) require explicit data-migration scripts checked in alongside.

### Seed (`db/seed/`)

Run idempotently on fresh deployment:
- **superadmin.ts** — reads `SUPERADMIN_EMAIL` env, creates `staff_users` row with role=`superadmin`, status=`pending` (real activation via Clerk first-login)
- **email-templates.ts** — inserts the 21 templates with default subject + body
- **waiver.ts** — inserts the singleton waiver row with placeholder body
- **policy.ts** — inserts singleton `global_policy` and `pt_booking_config` with sensible defaults

---

## 8. Phase Boundaries

**This phase (in scope):**
- All schema in §4
- All modules in §2 except `reports/`, `referrals/`, `instructor-portal/`, `dashboard/`, `audit-ui/`
- All cron handlers in §5
- `audit_log` table populated; admin-facing read views deferred

**Next phase (per `admin-restructure.md` §19):**
- Reports module — read-only aggregate queries over existing tables
- Referrals module — `clients.referred_by_client_id` already populated; reward-grant logic deferred
- Audit log surfacing UI — table populated this phase; read endpoints + admin views deferred
- Instructor portal — same data, different scoping (`routes.instructor.ts` files added incrementally)
- Dashboard — read-only metric aggregates

---

## 9. Open Questions

1. **Postgres host** — Neon (branching), Supabase Postgres, RDS, or self-hosted?
2. **Redis host for BullMQ** — Upstash (serverless-friendly) or self-hosted?
3. **Deployment target** — Fly.io / Railway / Render are good fits for both HTTP + worker. Vercel is HTTP-only (no long-lived worker).
4. **Email rendering** — React Email (rich JSX templates) or plain HTML with `{{var}}` substitution? React Email is nicer DX but adds a build step.
5. **Stripe webhook event de-dupe** — add `stripe_webhook_events` table now, or rely on `stripe_payments.payment_intent_id` uniqueness?
