# Backend Architecture — ReserveToday

The structural spine for the ReserveToday backend (`/be`). Stack, folder structure, database schema, external integrations, jobs, and shared cross-cutting infrastructure live here. Per-audience surface (routes, endpoints, business flows) lives in two sister docs:

- **`be-portal.md`** — staff backend (admin + instructor scopes), maps `admin-restructure.md` behaviour onto routes/services.
- **`be-client.md`** — client backend (`/me/*` and public reads), maps `fe-client-features.md` behaviour onto routes/services.

The single backend serves **both** `fe-portal` and `fe-client`. `fe-portal` is the staff app (admin + instructor views) signing in on the `staff` auth pool; `fe-client` is the client app signing in on the separate `client` pool; the super portal signs in on the `platform` pool. URL prefixes:

- `/api/v1/public/*` — unauthenticated reads (catalog, marketing, referral resolve)
- `/api/v1/auth/{client,staff,platform}/*` — the three Better Auth pools (sign-in, sign-out, codes, password reset, 2FA)
- `/api/v1/me/*` — `client` pool session (see `be-client.md`)
- `/api/v1/portal/admin/*` and `/api/v1/portal/instructor/*` — `staff` pool session (see `be-portal.md`)
- `/api/v1/platform/*` — `platform` pool session + `PLATFORM_ADMIN_EMAIL`
- `/api/v1/webhooks/*` — Stripe and Resend signed webhooks

---

## 1. Stack

| Concern | Pick |
|---|---|
| HTTP framework | **Hono** + `@hono/zod-validator` |
| ORM | **Drizzle** (pg dialect, `postgres-js` driver) |
| Database | **Postgres** |
| Validation | **Zod** |
| Auth | **Better Auth**, self-hosted — three pools on separate tables: `client`, `staff`, `platform` (per §15b session isolation). Bearer sessions. See `docs/adr/0004-self-hosted-auth-with-better-auth.md` |
| File storage | **Cloudflare R2** (S3-compatible via `@aws-sdk/client-s3`) — presigned PUT for public imagery, server-side upload + signed GET for private documents (§6c) |
| Background jobs | **`node-cron`** for non-critical periodic jobs (reminders, expiry sweeps); **BullMQ** (Redis-backed) added when the durable refund flow lands. Until then, no Redis dependency. |
| Email | **Resend** HTTP API (transactional, 22 templates per §17). One API key, two envelope addresses on the platform's verified domain — see §6d. |
| Payments | **Stripe** (Payment Intents + Refund API; no Subscriptions in v1) |

---

## 2. Folder Structure

The layout splits **routes by audience** (single-owner folders → minimal merge collisions between the two devs working in parallel) and **services by feature** (one source of domain rules → admin force-cancel and client self-cancel hit the same `services/bookings/cancel.ts`, so policy can't drift between flows).

Top-level audience split is **portal vs client vs public vs webhooks**. `portal/` groups admin + instructor since they share the `staff` auth pool and a single `staff_users` identity (role differentiates at middleware). `client/` is the separate `client` pool.

```
be/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── .env.example
└── src/
    ├── server.ts                      # Node entry — boots Hono app + cron schedulers
    ├── app.ts                         # Hono instance + global middleware + route mounting
    ├── env.ts                         # Zod-validated env vars (loaded once)
    │
    ├── db/
    │   ├── client.ts                  # Drizzle + postgres-js connection (singleton)
    │   ├── enums.ts                   # pgEnum definitions (one place for all enums)
    │   ├── schema/
    │   │   ├── index.ts               # Re-exports tables
    │   │   ├── identity.ts            # clients, staff_users, staff_invitations
    │   │   ├── catalog.ts             # locations, class_types, instructors, instructor_class_types, merch, merch_orders
    │   │   ├── policy.ts              # global_policy, pt_booking_config (singletons)
    │   │   ├── packages.ts            # class_packages, pt_packages, client_packages, promotions
    │   │   ├── schedule.ts            # classes, workshops, workshop_days, workshop_tiers,
    │   │   │                          #   workshop_tier_days, workshop_images, workshop_instructors,
    │   │   │                          #   pt_requests, pt_sessions, pt_session_clients
    │   │   ├── # availability.ts      # REMOVED in v1 — see §4f (replaced by pt_requests)
    │   │   ├── bookings.ts            # bookings, cancellations, check_ins
    │   │   ├── ledger.ts              # manual_adjustments, audit_log, stripe_payments
    │   │   ├── content.ts             # email_templates, email_log, waiver, waiver_signatures, marketing_content
    │   │   ├── inbox.ts               # inbox_items
    │   │   ├── ops.ts                 # feature_flags
    │   │   └── relations.ts           # All Drizzle `relations()` declarations
    │   ├── seed/
    │   │   ├── run.ts                 # Orchestrator (idempotent)
    │   │   ├── email-templates.ts     # Seed 22 default templates per §17b
    │   │   ├── waiver.ts              # Seed placeholder waiver body per §18a
    │   │   ├── marketing.ts           # Seed marketing_content singleton with placeholder copy
    │   │   └── policy.ts              # Seed defaults: global_policy, pt_booking_config
    │   └── migrations/                # drizzle-kit-generated SQL
    │
    ├── routes/                        # Audience-split — single-owner folders
    │   ├── portal/                    # Staff pool (admin + instructor share `staff_users`)
    │   │   ├── index.ts               # Mounts /admin and /instructor under shared staff auth
    │   │   ├── admin/                 # Owned by fe-portal dev — gated by require-role('admin')
    │   │   │   ├── index.ts           # Mounts all admin routers
    │   │   │   ├── locations.ts
    │   │   │   ├── class-types.ts
    │   │   │   ├── instructors.ts     # CRUD + archive/restore + invite
    │   │   │   ├── policy.ts          # read + update singletons
    │   │   │   ├── class-packages.ts  # CRUD incl. Trial Pass (§5)
    │   │   │   ├── pt-packages.ts     # CRUD (§6)
    │   │   │   ├── promotions.ts      # CRUD nested under class_packages / pt_packages / workshops (§5d, §19)
    │   │   │   ├── workshops.ts       # workshops CRUD + days + tiers + tier_day junction (§19)
    │   │   │   ├── schedule.ts        # class create/edit/admin-cancel + workshop admin-cancel (§7)
    │   │   │   ├── pt-requests.ts     # PT Request triage queue — approve/decline/schedule (§9)
    │   │   │   ├── pt-sessions.ts     # admin cancel of confirmed PT sessions
    │   │   │   ├── bookings.ts        # admin cancel + roster
    │   │   │   ├── check-in.ts        # generic page + per-session (§11)
    │   │   │   ├── inbox.ts           # list, mark read, approve/decline PT (§13)
    │   │   │   ├── clients.ts         # list, profile, status toggle, adjustments (§16)
    │   │   │   ├── staff.ts           # list, invite, revoke, archive, resend invite (§15)
    │   │   │   ├── notifications.ts   # email template editor (§17)
    │   │   │   ├── waiver.ts          # edit waiver text + signed count (§18)
    │   │   │   ├── marketing.ts       # edit hero / pricing / footer copy
    │   │   │   └── feature-flags.ts   # toggle ops flags
    │   │   └── instructor/            # gated by require-role('instructor'|'admin')
    │   │       ├── index.ts
    │   │       ├── schedule.ts        # own schedule view
    │   │       ├── roster.ts          # own session rosters
    │   │       ├── check-in.ts        # own (QR + code + manual)
    │   │       ├── pt-requests.ts     # PT requests for own sessions
    │   │       │  # availability.ts   # REMOVED — Availability system gone (§4f)
    │   │       └── profile.ts         # own bio / photo
    │   │
    │   ├── client/                    # Owned by fe-client dev — client pool session + require-active
    │   │   ├── index.ts               # Mounts all client routers under /api/v1/me
    │   │   ├── me.ts                  # profile, dashboard (§16, fe-client /account)
    │   │   ├── catalog.ts             # browse classes, workshops, packages, instructor availability for PT picker
    │   │   ├── bookings.ts            # book + cancel + view own + QR
    │   │   ├── pt-sessions.ts         # submit request + view own + cancel
    │   │   ├── purchases.ts           # initiate Stripe checkout (package or workshop)
    │   │   ├── invoices.ts            # list, filter, receipt link
    │   │   ├── waiver.ts              # read for sign + sign endpoint
    │   │   └── referral.ts            # own referral code + conversion stats
    │   │
    │   ├── public/                    # Unauthenticated reads — no session required
    │   │   ├── index.ts
    │   │   ├── catalog.ts             # locations, classes, workshops, packages (browse)
    │   │   ├── marketing.ts           # hero / testimonials / pricing blurb / footer
    │   │   └── referral.ts            # GET /referral/by-code/:code — resolve at register
    │   │
    │   └── webhooks/                  # Public endpoints with vendor signature verification
    │       ├── index.ts
    │       ├── stripe.ts              # payment_intent.succeeded → grant; charge.refunded → mark
    │       └── resend.ts              # delivered / bounced / complained / suppressed → email_log status, with alerts
    │
    ├── services/                      # Per-feature — jointly owned, single source of domain rules
    │   ├── bookings/
    │   │   ├── book.ts                # Class book (capacity + credit deduct in tx)
    │   │   ├── cancel.ts              # Cancel flow (client + admin paths) — calls services/policy
    │   │   ├── refund-outcome.ts      # Decide credit_returned | session_returned | stripe_refunded | forfeited
    │   │   └── qr.ts                  # `generateBookingCodes()` → { qrToken, code }
    │   ├── workshops/
    │   │   ├── publish.ts             # Validate basics + days + tiers + tier_days + images on save (§19)
    │   │   ├── days.ts                # Day CRUD + per-day capacity-vs-booked validation
    │   │   ├── tiers.ts               # Tier CRUD + workshop_tier_days junction rewrites
    │   │   └── refund-fanout.ts       # Workshop admin-cancel → enqueue stripe-refund per booking
    │   ├── pt-sessions/
    │   │   ├── request.ts             # Client submits pt_requests row (no inbox insert in v1)
    │   │   ├── schedule.ts            # scheduleFromRequest — converts pt_requests → pt_sessions + bookings
    │   │   ├── decline.ts             # Decline / expire / cancel a pt_requests row
    │   │   └── cancel.ts              # Cancel a confirmed pt_sessions row
    │   ├── promotions/
    │   │   └── resolve.ts             # bestPriceFor(parent_type, parent_id) — best-price-wins resolver
    │   ├── packages/
    │   │   ├── purchase.ts            # On Stripe success: insert client_packages row
    │   │   ├── adjust.ts              # Manual credit/session adjust (§16d) — writes manual_adjustments
    │   │   └── expire.ts              # Cron: mark expired, send reminder
    │   ├── billing/
    │   │   ├── webhook-handler.ts     # Stripe webhook → grants
    │   │   └── refunds.ts             # Stripe Refund API wrapper (queue handler when BullMQ lands)
    │   ├── notifications/
    │   │   ├── send.ts                # `enqueueEmail(slug, recipient, vars)` — used by all services
    │   │   ├── render.ts              # Variable substitution + sanitisation
    │   │   └── variables.ts           # Allowed variables per template slug (validation source)
    │   ├── policy/
    │   │   ├── evaluate-cancellation.ts # `evaluateCancellation(client, kind, sessionStartsAt, now)` (§4)
    │   │   └── event-state.ts         # `computeEventState({ starts_at, ends_at, lifecycle, now })`
    │   ├── auth/
    │   │   ├── better-auth.ts         # The three Better Auth pools + session reader
    │   │   ├── auth-users.ts          # Passwordless pool users for seeds + invitations
    │   │   └── invitations.ts         # Pending staff + auth user + token, mailed set-password link
    │   ├── clients/
    │   │   ├── profile.ts             # GET/PATCH self profile
    │   │   ├── dashboard.ts           # Next-up + balances aggregation
    │   │   └── admin-views.ts         # List + detail aggregations for admin clients page
    │   ├── inbox.ts                   # Insert / mark read / resolve action
    │   ├── waiver.ts                  # Read singleton + sign
    │   ├── marketing.ts               # Read + update marketing_content
    │   ├── referrals.ts               # Code generate + conversion grant via manual_adjustments
    │   └── feature-flags.ts           # Read (cached) + toggle
    │
    ├── middleware/
    │   ├── client-auth.ts             # `client` pool session + Tenant claim → load `clients` row
    │   ├── staff-auth.ts              # `staff` pool session + Tenant claim → load `staff_users` row
    │   ├── platform-admin.ts          # `platform` pool session + PLATFORM_ADMIN_EMAIL
    │   ├── require-role.ts            # Factory: `requireRole('admin' | 'instructor')`
    │   ├── require-active.ts          # Block suspended clients / archived staff
    │   ├── impersonate.ts             # Admin acts as a member (sets ctx.actingAs + audit)
    │   ├── audit.ts                   # Auto-write audit_log on mutating staff requests
    │   ├── validate.ts                # `@hono/zod-validator` wrapper conventions
    │   ├── rate-limit.ts              # Hono rate-limiter (public + authenticated tiers)
    │   ├── error.ts                   # AppError → HTTP mapping
    │   └── request-id.ts              # Trace ID per request
    │
    ├── lib/
    │   ├── stripe.ts                  # Stripe SDK + signed webhook verification
    │   ├── r2.ts                      # S3 client + private-bucket put + signed-GET helpers
    │   ├── mailer.ts                  # Resend transport (API key + two from-addresses from env) + send wrapper
    │   ├── time.ts                    # SGT (`Asia/Singapore`) conversions
    │   ├── richtext.ts                # Sanitise/render rich text bodies (waiver, workshop description, email)
    │   ├── capacity.ts                # `getBookedCount(classId | workshopTierId)` query helpers
    │   └── feature-flags-cache.ts     # In-memory cache populated at boot + on toggle
    │
    ├── jobs/
    │   ├── cron.ts                    # `node-cron` registrations — daily 03:00 SGT
    │   ├── handlers/
    │   │   ├── checkin-nag.ts         # Daily — sessions ended 24h ago with `pending` check-in
    │   │   ├── credit-expiry.ts       # Daily — client_packages expiring in ~7 days
    │   │   └── send-email.ts          # Render via services/notifications/render → SMTP transport (lib/mailer.ts) → log
    │   └── queue/                     # ADDED WHEN BullMQ lands for refund durability
    │       ├── queues.ts              # BullMQ queue instances + Redis connection
    │       ├── worker.ts              # Worker process entry (separate from HTTP)
    │       └── stripe-refund.ts       # Per-booking refund on workshop admin-cancel (§7a)
    │
    └── shared/
        ├── errors.ts                  # AppError, NotFoundError, ConflictError, ForbiddenError
        ├── http.ts                    # Hono response helpers (`ok`, `created`, etc.)
        └── types.ts                   # Shared TS types (Hono context augmentation)
```

**Run topology (v1):** single long-lived Node process (`src/server.ts`) running Hono HTTP + `node-cron` schedulers in-process. **When BullMQ is added** (for durable Stripe refund retries), introduce a second process — `src/jobs/queue/worker.ts` — sharing the same Drizzle client and `services/`. No shared in-memory state between processes.

**Hard rule:** no business logic in `routes/*`. Route handlers do `auth → zod parse → call service → format response`. Every domain rule (cap evaluation, refund decision, credit return, event-state computation) lives in `services/*`. This is what makes the audience split safe — admin force-cancel and client self-cancel both call `services/bookings/cancel.ts`, so policy can't drift between them.

---

## 3. Routing & Mounting

The top-level mount lives in `be/src/app.ts`:

```ts
const app = new Hono();

app.use('*', requestId, errorBoundary);
app.use('/api/v1/public/*', rateLimitPublic);
app.use('/api/v1/me/*',     rateLimitAuthed);
app.use('/api/v1/portal/*', rateLimitAuthed);

app.route('/api/v1/public',   publicRoutes);
app.route('/api/v1/me',       clientRoutes);        // see be-client.md
app.route('/api/v1/portal',   portalRoutes);        // see be-portal.md
app.route('/api/v1/webhooks', webhookRoutes);
```

The `portal/*` prefix mirrors the `staff` pool boundary: one auth gate for both admin and instructor; role-specific gates added per sub-router. A session from another pool (member session presented to `/portal`, staff session to `/me`) is a row that pool has never seen, and is rejected 401 at `staffAuth` / `clientAuth`.

**Hard rule for every route file:** `auth → zod parse → call service → format response`. Business logic lives in `services/<feature>/*`, not in route files. This is what lets admin and client share the same domain rules without drift.

Per-audience endpoint enumeration, mount internals, middleware stacks, and business flows are documented in:

- **`be-portal.md`** — staff auth (admin + instructor), endpoint tables per route file, portal-driven flows (staff invitations, schedule create, admin cancel + refund fanout, manual adjustments, PT approval, inbox, etc.).
- **`be-client.md`** — member auth + verification gate, public reads, client endpoints, client-driven flows (registration, booking, self-cancel, purchases, referral conversion).

### File ownership

- `routes/portal/admin/*`, `routes/portal/instructor/*` — fe-portal dev (single-owner; minimal merge collisions)
- `routes/client/*` — fe-client dev (single-owner)
- `routes/public/*`, `routes/webhooks/*`, `services/*`, `db/schema/*`, `middleware/*`, `lib/*` — joint, PR-reviewed by both devs

---

## 4. Database Schema

All tables use `id uuid primary key default gen_random_uuid()` unless noted. Timestamps are `timestamptz`. Soft delete is a nullable `archived_at`. Money is `numeric(10, 2)` SGD. All FKs `on delete restrict` (we soft-delete) unless noted.

### 4a. Identity

#### `clients`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| auth_user_id | text | not null, unique per tenant — the member's `client_auth_users` id |
| email | text | unique, not null |
| name | text | not null |
| phone | text | not null |
| gender | enum `client_gender` | nullable — values: `female`, `male`, `non_binary`, `prefer_not_to_say`. Optional at registration. |
| dob | date | nullable — optional at registration; client may add later via `/account/profile`. |
| status | enum `client_status` | not null, default `'active'` — values: `active`, `suspended` |
| suspended_at | timestamptz | nullable |
| referred_by_client_id | uuid | FK → clients.id, nullable, on delete set null (self-FK) |
| referral_credit_granted_at | timestamptz | nullable — set when we have credited this client's referrer; gates idempotency (see §7 Referral conversion crediting) |
| joined_at | timestamptz | not null, default now() |
| created_at, updated_at | timestamptz | not null, default now() |

**Indexes:** `(tenant_id, auth_user_id) unique`, `(tenant_id, email) unique`, `(status)`, `(referred_by_client_id)`, `(lower(name))` for case-insensitive search.

**Phone/email verification state — not stored on `clients`.** A member's email is proven by the code at registration, or by the set-password link they followed (#173). Phone verification (`fe-client-features.md`) is not built; its state would belong on the `client` pool user.

#### `staff_users`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| auth_user_id | text | not null, unique per tenant — the `staff_auth_users` id, written by the invitation or seed that made the row |
| email | text | unique, not null |
| name | text | not null |
| role | enum `staff_role` | not null — `admin`, `instructor`. Rank is admin > instructor: nobody edits a staff member who outranks them, and only an admin changes a role (`services/auth/staff-rank.ts`). See `be/docs/adr/0006-two-staff-roles.md`. |
| status | enum `staff_status` | not null, default `'pending'` — `pending`, `active`, `archived` |
| archived_at | timestamptz | nullable |
| archived_by_staff_id | uuid | FK → staff_users.id, nullable |
| invited_at, accepted_at | timestamptz | nullable |
| created_at, updated_at | timestamptz | not null, default now() |

**Indexes:** `(tenant_id, auth_user_id) unique`, `(tenant_id, email) unique`, `(role, status)`.

**Hard delete: never** (per §15c). Archive only. Email uniqueness enforces "one email = one staff account."

**Workspace semantics.** `locations.id` doubles as the workspace identifier referenced here. All workspace-scoped portal reads (Schedule, Workshops, Check-in, Inbox) filter by the selected location — see `be-portal.md` §1 for the middleware contract. An admin may select any of the studio's active locations; there are no per-staff location grants (the `granted_location_ids` column was dropped in the two-roles migration — ADR 0006).

**Last-admin guard.** Archiving a staff member, or changing their role away from `admin`, is refused when the target is the studio's only active admin — `role = 'admin'`, `status = 'active'`, not soft-deleted. The count and the write run in one transaction, so two concurrent removals cannot both pass. Delete requires an already-archived row and so needs no check of its own; signing a staff member out everywhere is not guarded. Changing your own role and archiving yourself stay refused. The guard lives in one place in the staff service, and every removal path calls it.

#### `staff_invitations`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| email | text | not null |
| role | enum `staff_role` | not null — `admin` or `instructor`, defaulting to `admin`. Only an admin may send an invitation. |
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

#### `rooms` — physical spaces, location-scoped

id, location_id (uuid, FK → locations.id, on delete restrict, not null), name (text, not null), capacity (integer, not null, CHECK `> 0` — reference metadata only; does **not** cap a session's booking capacity), archived_at (nullable).
**Indexes:** `(location_id, archived_at)`, unique `(location_id, lower(name))` so a location can't have two rooms with the same name.

Every scheduled `classes` / `workshop_days` / `pt_sessions` row carries a `room_id` (nullable in DB so legacy rows survive; **required at the app layer** for new creates/reschedules). The scheduler hard-blocks two **active** sessions sharing a room at overlapping times, across all three tables (see `services/schedule/room-conflicts.ts`).

**Archive blocking:** blocked if any active future `classes` / `workshop_days` / `pt_sessions` reference the room. Returns `409 room_in_use` with the offending ids.

#### `class_types`

id, name (text, not null), description (text, nullable — short blurb shown to clients on `/classes` and workshop cards per `admin-restructure.md` §3), parent_id (uuid, FK → class_types.id, on delete restrict, nullable — single-level hierarchy with depth capped at 1; enforced at service layer: a row whose `parent_id IS NOT NULL` cannot itself be referenced as a parent), archived_at (nullable).
**Indexes:** `(archived_at)`, `(lower(name))` for search, `(parent_id)` for child lookup.

**Archive blocking** (per `admin-restructure.md` §3): blocked if any `instructor_class_types` references the type, or any active future `classes`/`workshops` reference it. For parents, also blocked while any child still has linked data — service walks children + checks each.

#### `instructors` — 1:1 extension of staff_users where role=instructor

| Column | Type | Constraints |
|---|---|---|
| staff_user_id | uuid | PK + FK → staff_users.id, on delete cascade |
| photo_r2_key | text | nullable |
| bio | text | nullable |
| phone | text | nullable — overrides staff_users.phone if needed (admin doc §3 lists this) |
| annual_leave_days | int | not null, default 14 — **Assigned Days**, annual. Per instructor, set on the staff profile by an admin. The input to next year's Pool, not a balance. |
| medical_leave_days | int | not null, default 14 — Assigned Days, medical. |
| study_leave_days | int | not null, default 7 — Assigned Days, study. The third Leave Type; backfilled on every existing row rather than granted per instructor, because study leave is for everyone. |

#### `leave_conflicts` — declared **Leave Conflicts** (§17)

Two instructors an admin has declared cannot be away at the same time. Replaced `instructors.in_cover_group` and `global_policy.cover_group_leave_cap`, both dropped in `0024_retire_cover_group.sql`; the survey behind that decision is `docs/md/research-cover-group-ux.md`.

| Column | Type | Constraints |
|---|---|---|
| instructor_a_id | uuid | FK → instructors.staff_user_id, on delete cascade |
| instructor_b_id | uuid | FK → instructors.staff_user_id, on delete cascade |
| **PK** (instructor_a_id, instructor_b_id) | | uniqueness over the pair |
| **CHECK** `instructor_a_id < instructor_b_id` | | canonical ordering |

The two constraints together are what make symmetry a **database guarantee rather than an application convention**: the CHECK forces the lower id into the first column, so the reversed row cannot exist, and the primary key stops the same pair being declared twice. The CHECK also rules out a self-pair. Callers normalise before writing; these are the backstop. Rows cascade on instructor deletion, and an archived instructor's declarations refuse nothing (the rule input is filtered to active instructors, so archiving is reversible without touching the table).

The list is saved as **one replacement set** in the same transaction as the numeric Global Policy fields — `PATCH /portal/admin/policy/global` carries `leave_conflicts` — so a half-applied save cannot leave a cap raised over a set that never changed. That transaction takes every `instructors` row lock in staff-user-id order first, matching the order a leave submission takes its locks in, so the two cannot deadlock.

The leave tables themselves (`leave_requests`, `leave_pools`) are specified in `spec-instructor-leave.md` and `spec-instructor-leave-pools.md`, with `be/CONTEXT.md` binding on the vocabulary; `be/docs/adr/0001-per-instructor-leave-pools-with-carry-over.md` records why a Pool is stored.

#### `instructor_class_types` — M:N eligibility (§3)

| Column | Type | Constraints |
|---|---|---|
| instructor_id | uuid | FK → instructors.staff_user_id, on delete cascade |
| class_type_id | uuid | FK → class_types.id, on delete restrict |
| **PK** (instructor_id, class_type_id) |

#### `merch` — studio goods (mats, props, apparel)

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| title | text | not null |
| description | text | nullable |
| price_sgd | numeric(10,2) | not null, CHECK >= 0 |
| image_r2_key | text | nullable — `merch/<id>.<ext>`, served via `R2_PUBLIC_URL` |
| archived_at | timestamptz | nullable — hides the item from `/public/merch` and refuses new checkouts |
| created_at | timestamptz | not null, default now() |

Index on `archived_at`. **No stock count and no location**: merch is paid for online and handed over physically at the studio. Delete is a real `DELETE` — nothing references a merch row.

#### `merch_orders` — a merch purchase

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| client_id | uuid | FK → clients.id, on delete restrict, not null |
| merch_id | uuid | FK → merch.id, **on delete set null**, nullable |
| title | text | not null — frozen at purchase |
| amount_sgd | numeric(10,2) | not null — frozen at purchase |
| stripe_payment_intent_id | text | nullable (a free item never reaches Stripe), UNIQUE |
| created_at | timestamptz | not null, default now() |

Index on `(client_id, created_at)`. There is no fulfilment state: the row IS the purchase-history line the front desk hands the item over against. `title`/`amount_sgd` are frozen and `merch_id` goes null on delete so history reads as what was actually bought however the catalogue changes afterwards. The unique intent is what makes a second webhook delivery (or the confirmation page's `sync-session`) a no-op.

### 4c. Policy (singletons)

Both tables enforce single row at app layer. We use `id uuid PK` plus a `CHECK` that pins to a known sentinel value.

#### `global_policy` (§4)

cancel_cap_count int, cancel_cap_cycle_days int, class_window_hours int, pt_window_hours int, leave_carry_over_cap_days int (not null, default 14 — the studio-wide ceiling on unused **annual** days carrying into the next Leave Year; the only leave figure that is global), cross_location_rate_sgd numeric(10,2) (the Cross-Location Add-On's monthly rate — read once, at checkout, so repricing moves future purchases only; `spec-pre-launch-batch.md` §5), study_leave_cap int (not null, default 1, minimum 1 — the **Leave Cap**: the greatest number of instructors studio-wide who may be on study leave at once, counting study leave only; `spec-pre-launch-batch.md` §17. Who may not be away *with whom* is not a number and lives in `leave_conflicts`), updated_at, updated_by_staff_id (FK).

#### `pt_booking_config` (§6)

book_in_advance_days int, updated_at, updated_by_staff_id (FK).

### 4d. Packages

#### `class_packages` (admin catalogue per §5)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| name | text | not null |
| description | text | nullable — short blurb rendered on the package card |
| kind | enum `class_package_kind` | `credit_bundle`, `unlimited`, `trial` |
| credits | int | nullable — required when kind in (`credit_bundle`, `trial`) |
| validity_days | int | nullable — optional when kind=`trial` (null = no expiry), required when kind=`credit_bundle` |
| duration_months | int | nullable — required when kind=`unlimited`; whole calendar months |
| price_sgd | numeric(10, 2) | not null |
| status | enum `package_status` | `active`, `archived` |
| archived_at | timestamptz | nullable |

**Indexes:** `(status, kind)`. Partial unique index `(kind) WHERE kind='trial' AND status='active'` is **not** applied — multiple active Trial Pass definitions are allowed at the catalogue level; the one-per-client gate is enforced on `client_packages`, not here.

**CHECK:** kind-specific column requirements (Postgres CHECK constraint):
- `credit_bundle` → credits NOT NULL, validity_days NOT NULL, duration_months NULL
- `unlimited` → credits NULL, validity_days NULL, duration_months NOT NULL
- `trial` → credits NOT NULL, validity_days NOT NULL, duration_months NULL

#### `pt_packages` (§6)

id, name, description (text, nullable), session_type enum (`1on1`, `2on1`), num_sessions int, validity_days int, instructor_bound boolean, price_sgd, status, archived_at.

`validity_days` is NOT NULL and `> 0` (`pt_packages_validity_days_positive`). The figure is frozen onto `client_packages.validity_days` at purchase and a PT package expires at **Activation** (its first session request) plus this figure, through the same `activationExpiry` helper a Credit Bundle goes through (ADR 0004) — there is no global PT validity constant. Migration `0044` backfilled 365 (what that constant had been applying) onto every existing row before the NOT NULL landed.

`instructor_bound` is NOT NULL, default `false` (migration `0045`) — **Instructor-Bound**. When true, a member buying this package must choose one active instructor at checkout and the purchase lands carrying `client_packages.bound_instructor_id`; when false the member is asked nothing and a pick is refused. The flag is read at purchase and never copied onto the purchased row, so editing it moves future sales only. `instructorForPurchase` (`services/packages/purchase.ts`) is the pure rule — bound with no pick → `pt_bound_requires_instructor`, a pick on an unbound or non-PT package → `instructor_only_applies_to_bound_pt`, a pick outside the Tenant's active instructors → `instructor_not_active` — and both checkout and the grant call it, so a purchase refused at the grant was already refused before the member was charged.

#### `promotions` (`fe-client-features.md` §6.1, `admin-restructure.md` §5d, §19)

Polymorphic — a promotion belongs to exactly one parent (`class_package`, `pt_package`, or `workshop`). Best-price-wins is resolved at purchase time across all currently-windowed promotions on the parent; the winning row is frozen onto the resulting `client_packages.applied_promotion_id` / `bookings.applied_promotion_id`.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| parent_type | enum `promotion_parent` | `class_package`, `pt_package`, `workshop` |
| parent_id | uuid | id of the parent row (FK enforced at app layer because the target table varies — `class_packages.id`, `pt_packages.id`, or `workshops.id`) |
| label | text | not null — short tag rendered on the package/workshop card (e.g. "Launch promo", "Member discount") |
| kind | enum `promotion_kind` | `percent` (e.g. 20% off), `special_price` (absolute SGD that overrides regular price) |
| percent_off | int | nullable — 1..99, required when kind=`percent` |
| special_price_sgd | numeric(10, 2) | nullable — required when kind=`special_price` |
| starts_at | timestamptz | not null |
| ends_at | timestamptz | not null, CHECK ends_at > starts_at |
| status | enum `promotion_status` | not null, default `'active'` — `active`, `archived` (manual disable independent of the time window) |
| sort_id | bigserial | tie-break for best-price-wins when two promotions yield identical effective prices — lowest `sort_id` wins (deterministic, per `fe-client-features.md` §6.1) |
| created_at, updated_at | timestamptz | not null |
| created_by_staff_id | uuid | FK → staff_users.id |

**Indexes:** `(parent_type, parent_id, status, starts_at, ends_at)` for the in-window lookup at purchase time, `(sort_id)` for the tie-break.

**CHECK:** kind-specific column presence (`percent` → percent_off NOT NULL; `special_price` → special_price_sgd NOT NULL).

**No price-vs-regular validation at write.** Admin may publish a promotion whose effective price is higher than the parent's regular — best-price-wins will simply ignore it at purchase. UI surfaces a warning but the DB does not reject.

**No `feature_flags.promo_codes_enabled` gate.** Promotions are launch-day functionality; the prior "deferred behind flag" note is dropped — see §4k.

#### `client_packages` (per-client purchased instances — the actual entitlement ledger)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| client_id | uuid | FK → clients.id |
| kind | enum `client_package_kind` | `credit_bundle`, `unlimited`, `trial`, `pt` |
| source_class_package_id | uuid | FK → class_packages.id, nullable (set when kind in {credit_bundle, unlimited, trial}) |
| source_pt_package_id | uuid | FK → pt_packages.id, nullable (set when kind=`pt`) |
| applied_promotion_id | uuid | FK → promotions.id, nullable — set when a promotion resolved at purchase (best-price-wins, §4d Promotions). Frozen at purchase so a later change to the promotion row doesn't rewrite history. |
| applied_promo_code_id | uuid | FK → promo_codes.id, restrict, nullable — frozen the same way (`spec-pre-launch-batch.md` §9–§11). The identifier is frozen rather than the label, because staff may edit the label later; the money taken off is frozen on the redemption row, not here. |
| location_id | uuid | FK → locations.id, restrict — **the Home Location.** Required when kind=`unlimited`, null for every other kind (folded into `client_packages_kind_fields` below). |
| bound_instructor_id | uuid | FK → staff_users.id, restrict, nullable — **the Bound Instructor.** The one instructor this PT package's sessions are with; null means open to any of them. Only kind=`pt` may carry one (folded into `client_packages_kind_fields` below). The column IS the binding: the catalogue's `instructor_bound` flag is NOT copied here, so a package sold open can be bound later by filling this, and no second flag can go stale. `restrict` because a bound package outlives its instructor's archival — it stays bound and visibly so rather than silently reopening. |
| duration_months | int | nullable — the Unlimited Plan's Duration, frozen from the catalogue at purchase so a later catalogue edit can't lengthen a plan already sold. Required when kind=`unlimited`, null otherwise. |
| cross_location_paid_sgd | numeric(10, 2) | nullable, kind=`unlimited` only — null means the plan Covers its Home Location only; non-null is what the member paid for the Cross-Location Add-On, and the plan Covers both Locations. |
| list_price_sgd | numeric(10, 2) | not null, **including free purchases** — what the product was listed at before any Promotion or Promo Code, so a later catalogue change can't restate what a member was charged. Total discount is `list_price_sgd - amount_paid_sgd`, derived rather than stored a second time. |
| credits_or_sessions_remaining | int | nullable — null when kind=`unlimited` |
| expires_at | timestamptz | nullable — null means **Dormant** for an Unlimited Plan (waiting behind a plan still running); set for credit_bundle + unlimited-with-no-live-plan-in-front + trial (when validity_days set); null for pt and trial-without-expiry |
| purchased_at | timestamptz | not null |
| amount_paid_sgd | numeric(10, 2) | not null — effective price actually charged (may be 0 for admin-issued grants) |
| purchase_id | uuid | FK → `purchases`, **nullable** — the sale that bought the plan. Null for admin-issued grants (§16 manual issue) and free trial passes priced at 0 SGD, the same rows the payment intent it replaced (#92) was null for. A plan settled by more than one payment still has exactly one of these |
| active | boolean | not null, default true — the lever both the nightly expiry sweep and a Refund's Void pull; `false` means expired or refunded, and the payment row records which |

**`client_packages_kind_fields` CHECK** (`spec-pre-launch-batch.md` §1): `kind='unlimited'` requires `location_id` and `duration_months` NOT NULL; every other kind requires both NULL and `expires_at` NOT NULL. Extended in `0045`: `bound_instructor_id` must be NULL on every kind but `pt` — the column is the whole of what "bound" means, so a binding on any other kind would be one no rule in the domain knows how to read. Strict, no grandfathering — the backfill probe found zero Unlimited Plans in either database before this shipped.

**Indexes:** `(client_id, kind)`, `(client_id, expires_at)` for upcoming-expiry sweep, `(purchase_id) unique where not null` — one plan per sale, the index that decides a webhook-redelivery race — a **unique partial index `(client_id) WHERE kind='trial'`** — enforces the one-trial-per-client-ever invariant from `fe-client-features.md` §6.1 (a previously-purchased trial, active OR expired, blocks any further trial purchase; the purchase service catches the unique-violation and returns `409 trial_already_used`) — and a **unique partial index `(client_id) WHERE kind='unlimited' AND active AND expires_at IS NOT NULL`**, capping a client at one Activated Unlimited Plan (plus, enforced in the purchase path rather than an index, at most one Dormant one).

Promo Code tables (`promo_codes`, `promo_code_products`, `promo_code_redemptions`) live beside this table and are documented in full in `spec-pre-launch-batch.md` §9–§11 rather than repeated here — the model is the shipped one, not the used-count-plus-valid-from-window model an earlier draft of this document sketched.

### 4e. Schedule

**Lifecycle vs. event state.** Per §11, event state (`scheduled` → `ongoing` → `completed`) is time-derived. Admin-cancel is the only persisted state change. We therefore store only `lifecycle` (`active` / `cancelled`) on each schedule entity and **compute** event state at read time via `services/policy/event-state.ts`. This guarantees the timetable reflects reality immediately rather than waiting for a cron.

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
| capacity_online | int | not null, CHECK ≥ 0 — slots a client can self-book |
| capacity_waitlist | int | not null, default 0, CHECK ≥ 0 — waitlist slots offered when `capacity_online` is exhausted (deferred feature, see §8) |
| capacity_buffer | int | not null, default 0, CHECK ≥ 0 — reserve held back from self-booking (admin manual add / walk-in) |
| credit_cost | int | not null, CHECK ≥ 0 |
| lifecycle | enum `lifecycle` | not null, default `'active'` — `active`, `cancelled` |
| cancelled_at | timestamptz | nullable |
| cancelled_by_staff_id | uuid | FK → staff_users.id, nullable |
| created_at | timestamptz | not null |
| created_by_staff_id | uuid | FK → staff_users.id |

**Derived:** `max_capacity = capacity_online + capacity_waitlist + capacity_buffer` (per `admin-restructure.md` §7d). Computed at read time, never stored. CHECK that at least one of the three is > 0.

**Indexes:** `(starts_at)` for timetable range queries, `(instructor_id, starts_at)`, `(location_id, starts_at)`, `(class_type_id)`, `(lifecycle, starts_at)`.

#### `workshops` (§7e, §19 — multi-day)

A workshop is the parent record. Day-level scheduling lives in `workshop_days`; pricing lives in `workshop_tiers`; a tier covers a subset of days via `workshop_tier_days`. Tier capacity is **derived**, never stored — it equals `min(day.capacity_online)` across the days the tier covers (`admin-restructure.md` §19c, `fe-client-features.md` §4.1).

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| name | text | not null |
| class_type_id | uuid | FK → class_types.id |
| cover_r2_key | text | nullable |
| description_html | text | rich text, sanitised on write |
| location_id | uuid | FK → locations.id, not null — workshops are workspace-scoped per `admin-restructure.md` §7e |
| lifecycle | enum `lifecycle` | not null, default `'active'` |
| cancelled_at, cancelled_by_staff_id | | nullable |
| created_at, created_by_staff_id | | not null |

No `starts_at` / `ends_at` on `workshops` directly — those are inferred from `workshop_days` (min/max). Removed from the parent so admin can add/remove days post-create without rewriting the parent envelope.

**Indexes:** `(location_id, lifecycle)`, `(lifecycle)`.

#### `workshop_days` (NEW — `admin-restructure.md` §19, `fe-client-features.md` §4.1)

One row per workshop session-day. The Schedule view auto-renders one tile per `workshop_days` row with a `Day N/M` chip per `admin-restructure.md` §7c. Capacity is decomposed identically to `classes`.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| workshop_id | uuid | FK → workshops.id, on delete cascade |
| ord | int | not null — 1-based day index within the workshop |
| starts_at | timestamptz | not null |
| ends_at | timestamptz | not null, CHECK ends_at > starts_at |
| base_price_sgd | numeric(10, 2) | not null — informational reference for per-day pricing; actual purchase price comes from the selected tier |
| capacity_online | int | not null, CHECK ≥ 0 |
| capacity_waitlist | int | not null, default 0, CHECK ≥ 0 |
| capacity_buffer | int | not null, default 0, CHECK ≥ 0 |

**Indexes:** `(workshop_id, ord) unique`, `(starts_at)` for timetable range queries.

**CHECK:** `capacity_online + capacity_waitlist + capacity_buffer > 0`.

#### `workshop_images`

id, workshop_id (FK, on delete cascade), r2_key, ord (int).

#### `workshop_instructors` (M:N)

workshop_id, instructor_id, **PK** pair, both FKs, on delete cascade.

#### `workshop_tiers` (§19)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| workshop_id | uuid | FK → workshops.id, on delete cascade |
| name | text | not null — e.g. "Full Event", "Day 1 only" |
| description | text | nullable |
| regular_price_sgd | numeric(10, 2) | not null |
| early_bird_price_sgd | numeric(10, 2) | nullable |
| early_bird_quota | int | nullable |
| early_bird_cutoff_at | timestamptz | nullable |
| ord | int | not null — display order |

**No `capacity` column** — tier capacity is derived at read time as `min(workshop_days.capacity_online)` across the tier's covered days (`workshop_tier_days` junction). See `lib/capacity.ts:getTierAvailability(tier_id)`.

**Indexes:** `(workshop_id, ord)`.

#### `workshop_tier_days` (NEW junction — `admin-restructure.md` §19)

Which days each tier grants access to. A "Full Event" tier covers all `workshop_days`; a "Day 1 only" tier covers just the first.

| Column | Type | Notes |
|---|---|---|
| workshop_tier_id | uuid | FK → workshop_tiers.id, on delete cascade |
| workshop_day_id | uuid | FK → workshop_days.id, on delete cascade |
| **PK** (workshop_tier_id, workshop_day_id) | | |

**Indexes:** `(workshop_day_id)` for reverse lookup (capacity recompute on day edit).

#### `pt_requests` (reshape — `admin-restructure.md` §9, `fe-client-features.md` §5.2)

Client-submitted intent to schedule a private session. Has no `location_id` (assigned only at scheduling). The system invariant is: **no `pt_sessions` row may exist without a matching `pt_requests` row** (FK `pt_sessions.pt_request_id`).

The simplified v1 flow has **no in-app back-and-forth** — all negotiation is on WhatsApp. Admin schedules (implicit approval) or cancels; no decline-with-note, no approval step. Instructor preference is NOT captured (admin assigns at schedule time, informed by `class_type_id`).

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| client_id | uuid | FK → clients.id — the submitting client |
| class_type_id | uuid | FK → class_types.id, not null — yoga style / focus area |
| session_type | enum `pt_session_type` | `1on1`, `2on1` |
| co_client_id | uuid | FK → clients.id, nullable — set for 2on1 when partner is already a member (resolved via /pt-sessions/partner-lookup at submit) |
| co_client_name | text | nullable — set for 2on1 when partner is not yet a member; admin creates the account before scheduling |
| co_client_email | text | nullable — same, for the not-yet-a-member case |
| message | text | nullable — free-form note from client |
| status | enum `pt_request_status` | not null, default `'pending'` — `pending`, `scheduled`, `cancelled_before_scheduled`, `cancelled_after_scheduled`, `attended` (mirrored from booking check-in) |
| expires_at | timestamptz | not null — `created_at + ttl` from `pt_booking_config` (sweep job, §5) |
| scheduled_pt_session_id | uuid | FK → pt_sessions.id, nullable — set when status=`scheduled` |
| resolved_at, resolved_by_staff_id | | nullable — set on scheduled or either cancellation; staff id NULL for client-initiated / system (expiry) |
| created_at | timestamptz | not null |

**Indexes:** `(status, created_at desc)` — drives the `/admin/pt-requests` triage queue; `(client_id, status)` for client's own list; `(class_type_id)` for class-type filters; `(expires_at) WHERE status='pending'` for the expiry sweep.

**Workspace scope.** PT requests are workspace-agnostic per `admin-restructure.md` Overview — every admin sees the same triage queue regardless of the selected location.

#### `pt_request_slots` (1..N proposed slots per request)

Each row is one date+time-frame option the client put forward. Admin picks any one (or any negotiated alternative) at scheduling.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| pt_request_id | uuid | FK → pt_requests.id, on delete cascade |
| proposed_date | date | not null |
| start_time | time | not null |
| end_time | time | not null, CHECK > start_time |

**Indexes:** `(pt_request_id)`.

#### `pt_sessions` (created when a PT request is scheduled by admin/instructor)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| pt_request_id | uuid | FK → pt_requests.id, **not null, unique** — every session traces back to a request |
| instructor_id | uuid | FK → instructors.staff_user_id, not null |
| location_id | uuid | FK → locations.id, not null — assigned at scheduling time |
| starts_at, ends_at | timestamptz | not null, CHECK ends_at > starts_at — may differ from request's `preferred_*` after admin negotiation |
| session_type | enum `pt_session_type` | `1on1`, `2on1` — copied from request |
| capacity_online | int | not null, CHECK ≥ 0 — defaults from `session_type` (`1on1` → 1, `2on1` → 2) per `admin-restructure.md` §9 |
| capacity_waitlist | int | not null, default 0, CHECK ≥ 0 |
| capacity_buffer | int | not null, default 0, CHECK ≥ 0 |
| lifecycle | enum `lifecycle` | not null, default `'active'` — `active`, `cancelled`. PT sessions inherit the time-derived event state pattern (§4e header) since the request/decline/expire states are owned by `pt_requests`. |
| cancelled_at, cancelled_by_staff_id | | nullable |
| scheduled_at, scheduled_by_staff_id | | not null — who converted the request into a session |
| created_at | timestamptz | not null |

**Indexes:** `(instructor_id, starts_at)`, `(lifecycle, starts_at)`, `(pt_request_id) unique`.

#### `pt_session_clients` (M:N — supports 2-on-1)

pt_session_id, client_id, **PK** pair, FKs, on delete cascade.

#### `corporate_packages` (admin catalogue — surfaced to clients)

Corporate offerings (group/company sessions). Mirrors `pt_packages` shape but is purchased to **start a request**, not to grant credits.

id, name (text, not null), description (text, nullable), price_sgd (numeric(10,2), not null), status (enum `package_status` — `active`, `archived`), archived_at (nullable).

#### `corporate_requests` (request-driven flow — mirrors `pt_requests`, `admin-restructure.md` §9b)

Created automatically when a client buys a corporate package (no client form — negotiation happens over WhatsApp). The system invariant is: **a `corporate_sessions` row exists only by scheduling a `corporate_requests` row** (FK `corporate_sessions.corporate_request_id`).

Unlike `pt_requests`, the cancelled state is a **single** `cancelled` value (no before/after split), and there is **no `expires_at`** — a corporate request never auto-expires.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| client_id | uuid | FK → clients.id, **on delete restrict** — the purchasing member |
| corporate_package_id | uuid | FK → corporate_packages.id, **on delete restrict** |
| status | enum `corporate_request_status` | not null, default `'pending'` — `pending`, `scheduled`, `cancelled`, `attended` |
| message | text | nullable |
| scheduled_corporate_session_id | uuid | FK → corporate_sessions.id, **nullable** — set when status=`scheduled`. Deferred circular FK (see note below). |
| resolved_at | timestamptz | nullable — set on scheduled / cancelled / attended |
| resolved_by_staff_id | uuid | FK → staff_users.id, nullable |
| created_at | timestamptz | not null, default now() |

**Indexes:** `(status, created_at)` — drives the `/admin/corporate-requests` triage queue; `(client_id, status)` for the client's own list.

#### `corporate_sessions` (created when a corporate request is scheduled by admin)

A scheduled corporate session. Carries a `corporate_request_id` back-reference so request and session stay in lockstep; `client_name` is derived from the linked request's member record (no freeform name — the old admin-direct-create path that took a freeform client name is removed).

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| corporate_request_id | uuid | FK → corporate_requests.id, **nullable** — deferred circular FK (see note). Set at scheduling. |
| main_instructor_id | uuid | FK → instructors.staff_user_id, not null |
| location_id | uuid | FK → locations.id, not null |
| room_id | uuid | FK → rooms.id, not null |
| client_name | text | not null — derived from the member record on the linked request |
| starts_at, ends_at | timestamptz | not null, CHECK ends_at > starts_at |
| lifecycle | enum `lifecycle` | not null, default `'active'` — `active`, `cancelled` (time-derived event state per §4e header) |
| cancelled_at, cancelled_by_staff_id | | nullable |
| scheduled_at, scheduled_by_staff_id | | not null |
| created_at | timestamptz | not null |

Supporting instructors are stored M:N (`corporate_session_instructors` — `corporate_session_id`, `instructor_id`, **PK** pair, FKs on delete cascade). Room + instructor conflicts are checked at schedule time, reusing the existing corporate-session create logic.

**Circular FK note.** `corporate_requests.scheduled_corporate_session_id` and `corporate_sessions.corporate_request_id` reference each other. Both are declared `DEFERRABLE INITIALLY DEFERRED` so the schedule transaction can insert the session, then update the request, within one tx. **Migration:** `0010_corporate_requests.sql`.

### 4f. Availability — REMOVED in v1

Per `admin-restructure.md` §8: the Availability system has been removed. PT scheduling now flows from client-submitted `pt_requests` (§4e), and the scheduling service simply checks for instructor conflicts against existing `classes`, `workshops` (via `workshop_days`), and confirmed `pt_sessions` at the moment of admin approval — no stored availability calendar.

The previously-specified `instructor_availability_recurring` and `instructor_availability_oneoff` tables are **dropped** during the reshape. The `routes/portal/admin/availability.ts` and `routes/portal/instructor/availability.ts` route files are removed; the `services/availability/*` folder is removed; conflict-checking lives in `services/pt-sessions/schedule.ts:checkInstructorConflict(instructor_id, starts_at, ends_at)`.

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
| applied_promotion_id | uuid | FK → promotions.id, nullable — frozen at purchase when a workshop promotion resolved; null for class/PT bookings (where the promotion already froze onto the `client_packages` row used to book) |
| applied_promo_code_id | uuid | FK → promo_codes.id, restrict, nullable — same freeze as `client_packages.applied_promo_code_id`, for a workshop booking bought with a code |
| list_price_sgd | numeric(10, 2) | required for kind=`workshop`, null otherwise — the tier's price at purchase, frozen (`spec-pre-launch-batch.md` §15). Class and PT bookings are paid for by a package and their money stays on that row. |
| amount_paid_sgd | numeric(10, 2) | required for kind=`workshop`, null otherwise — what was actually charged, including 0 for a free tier or a comp grant read as a 100% discount |
| state | enum `booking_state` | `confirmed`, `cancelled`, `no_show` |
| credits_or_sessions_used | int | nullable — null for workshops + unlimited |
| refund_outcome | enum `refund_outcome` | `credit_returned`, `session_returned`, `stripe_refunded`, `forfeited`, `n_a` |
| check_in_state | enum `checkin_state` | `pending`, `attended`, `no_show`, `n_a` (workshops) |
| qr_token | text | unique, not null — encoded into QR |
| code | text | unique, not null — `RT-` + 6 Crockford-base32 chars (e.g. `RT-A4F2K9`); see §7 Per-booking codes for alphabet + lookup rules |
| purchase_id | uuid | FK → `purchases`, unique where not null — set only on a workshop booking, whose booking IS the purchase. Null for class and PT bookings, which a plan paid for (#92) |
| booked_at | timestamptz | not null |
| cancelled_at | timestamptz | nullable |

Workshop bookings cover **the tier**, not individual days. Per-day attendance / waitlist offerings are derived: the tier's `workshop_tier_days` rows enumerate which days the booking grants access to. Per-day capacity counts are computed by joining `bookings → workshop_tier_days` and counting confirmed rows whose tier covers that day. See `lib/capacity.ts:getWorkshopDayBookedCount(workshop_day_id)`.

**CHECK constraints (kind-specific FK presence):**
- kind=`class` → class_id NOT NULL, workshop_id NULL, pt_session_id NULL
- kind=`workshop` → workshop_id NOT NULL, workshop_tier_id NOT NULL, class_id NULL, pt_session_id NULL
- kind=`pt` → pt_session_id NOT NULL, class_id NULL, workshop_id NULL

**Indexes:**
- `(client_id, booked_at desc)` for "view own bookings"
- `(class_id, state)` for class roster + capacity count
- `(workshop_tier_id, state)` for tier capacity count + per-day count via join
- `(pt_session_id)` unique partial where kind=`pt` (one booking per PT session for 1-on-1; for 2-on-1 multiple bookings tied via pt_session_clients)
- `(qr_token) unique`, `(code) unique`
- `(check_in_state)` for "pending check-in" surfacing (§11)
- `(purchase_id) unique where not null`

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

id, payment_intent_id (text unique), amount_sgd, kind enum (`workshop`, `class_package`, `pt_package`, `corporate_package`, `merch`), client_id (FK), booking_id (FK, nullable), client_package_id (FK, nullable), status enum (`pending`, `succeeded`, `refunded`, `failed`), receipt_url (text, nullable — Stripe-hosted receipt; populated by `payment_intent.succeeded` webhook handler from `latest_charge.receipt_url`), refunded_at (nullable), created_at.

**Merch purchases.** A `kind='merch'` payment records the money and nothing else: no `client_packages` row and no booking — the delivered thing is the `merch_orders` row (§4b) and the item is handed over at the studio. `booking_id` and `client_package_id` stay NULL, so a refund of one unwinds to `stampRefunded` alone.

**Corporate purchases.** A `kind='corporate_package'` payment is recorded on `checkout.session.completed` like any other, but unlike `class_package` / `pt_package` it does **not** insert a `client_packages` row (corporate buys grant no credits — the resulting `corporate_requests` row is the entitlement). `client_package_id` stays NULL. See §4e `corporate_requests` and the webhook flow in §6b.

**Indexes:** `(payment_intent_id) unique`, `(client_id, created_at desc)`.

The fe-client `/account/invoices` "Download" link points directly to `receipt_url`; no PDF generation needed.

#### `tenant_payment_credentials` (#100)

tenant_id (uuid PK, FK → tenants.id on delete cascade), provider (text, not null, default `'stripe'`), account_id (text, not null), secret_key_sealed (text, not null), webhook_secret_sealed (text, not null), created_at, updated_at.

A studio's **own** payment-provider account: its credentials, so every call on that studio's behalf is made against that account rather than the platform's. Not Stripe Connect — there is no connected account and no `Stripe-Account` header; an account here is a *key*. See `be/docs/adr/0004-tenant-supplied-payment-credentials.md`.

**A Tenant with no row here charges on the platform account,** exactly as every Tenant did before, which is what lets studios be moved across one at a time.

**Both secrets are sealed** (AES-256-GCM, `be/src/lib/secret-box.ts`) with `PAYMENT_CREDENTIALS_KEY` from the environment, so a database backup is not a set of live payment keys. `account_id` is deliberately *not* sealed: it names the account rather than opening it, and it is the only thing the super portal ever shows back. No route returns either secret, masked or otherwise.

**Two doors, and only two.** Writes run inside `withTenant`, under the same Row-Level Security policy every other tenant-scoped table carries (migration 0048). Reads go through the owner-owned `tenant_payment_credentials_for(tenant_id)` — because the callers have no Tenant context to open: a background job has no request, and a webhook cannot open one until it knows whose delivery it is holding. The super portal's list reads `tenant_payment_accounts()`, which returns tenant ids and account ids and no sealed value at all.

### 4j. Content

#### `email_templates` (§17)

id, slug (text unique — 30 seeded values), subject (text), body_html (text), updated_at, updated_by_staff_id (FK).

**Slug list (30)** — the seed (`db/seed/email-copy.ts`) and the `TemplateSlug` union (`services/notifications/send.ts`) must agree on every entry, and `db/seed/email-copy.test.ts` fails the build if they drift:
```
welcome
client_invite
password_reset
class_booking_confirmed
pt_request_submitted
pt_session_approved
pt_session_declined
pt_request_expired                     # NEW — sweep job (§5) marks pending requests past expires_at
workshop_purchase_confirmed
workshop_waitlist_promoted             # NEW — fired when cancellation frees a seat and waitlist promotes (deferred behaviour, slug seeded now)
class_cancelled_credit_returned
class_cancelled_forfeited
pt_cancelled_session_returned
pt_cancelled_forfeited
admin_cancel_class
admin_cancel_pt
admin_cancel_workshop
instructor_cancel_class                # goes to every active admin, not to a member
leave_request_submitted                # goes to every active admin
leave_approved
leave_rejected
leave_revoked
package_purchase_confirmed             # every paid/comped package EXCEPT a trial, which has its own slug below
purchase_refunded
credit_expiry_reminder                 # also fires for trial pass expiry — `remaining_line` is composed per kind so a trial is never told about "credits"
instructor_invite
admin_invite
checkin_nag
referral_credited
trial_pass_purchase_confirmed          # NEW — distinct from package_purchase_confirmed; trial copy is friendlier ("welcome to your first 3 classes")
```

**The unreachable-slug gap is closed.** `pt_request_expired` and `workshop_waitlist_promoted` are now members of `TemplateSlug`, are declared in `TEMPLATE_VARIABLES`, and `db/seed/email-copy.test.ts` asserts slug-for-slug parity in both directions, so the class of gap that left the purchase templates unsent for months cannot reopen silently.

**Templates with no sender (copy ready, wiring outstanding).** Every row now carries real copy, but a template only reaches a member when some service calls it. These have no caller in `be/src`, and the copy is written not to promise otherwise:

| Slug | Where the sender belongs |
|---|---|
| `welcome` | Sign-in mail is the auth pools' own (`services/auth/sign-in-mail.ts`); wire this only if the studio wants its own. (`password_reset` is sent: it is the member's set-password link, #173.) |
| `class_booking_confirmed` | `services/bookings/book.ts`, after commit. |
| `class_cancelled_*`, `pt_cancelled_*` | `services/bookings/cancel.ts` — the forfeited pair needs `reason_line` from `policy/evaluate-cancellation.ts:forfeitLine`. |
| `admin_cancel_class`, `admin_cancel_pt`, `admin_cancel_workshop` | the admin cancel services. `admin_cancel_workshop` must not claim an automatic refund — `services/workshops/cancel.ts` marks bookings `refund_outcome='n_a'`. |
| `pt_session_approved`, `pt_session_declined`, `pt_request_expired` | `services/pt-sessions/schedule.ts` and `cancel.ts:expireStaleSessions`. |
| `credit_expiry_reminder` | `services/packages/expire.ts:sendLapsingAlerts` (still a TODO); compose `remaining_line` with `notifications/purchase-email.ts:contentsLine`. |
| `checkin_nag` | the `checkin-nag` cron. |
| `referral_credited` | `services/referrals.ts`. |
| `workshop_waitlist_promoted` | deferred with waitlist behaviour itself. |

#### `email_log`

id, template_slug (text), recipient_email (text), recipient_user_id (uuid, nullable), recipient_user_kind enum (`client`, `staff`), subject_rendered (text), body_rendered (text), status enum (`queued`, `sent`, `failed`, then Resend's webhook outcomes `delivery_delayed`, `delivered`, `bounced`, `complained`, `suppressed` — outcomes only move forward), smtp_message_id (text, nullable — the Resend email id the webhook matches on), smtp_response (text, nullable — last line of SMTP server response), error (text, nullable), queued_at, sent_at, outcome_at (nullable — when the webhook last moved status past `sent`).

**Indexes:** `(recipient_user_id, queued_at desc)`, `(status)`, `(template_slug, queued_at desc)`.

#### `waiver` (singleton — §18)

id, body_html (text), updated_at, updated_by_staff_id (FK).

#### `waiver_signatures`

id, client_id (FK, **unique** — one signature per client), signed_at.

#### `marketing_content` (singleton)

Drives admin-editable copy on the fe-client public pages (`/`, `/pricing`).

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| hero_heading | text | not null |
| hero_subheading | text | not null |
| pricing_blurb | text | nullable |
| testimonials | jsonb | array of `{ quote, author, location }` — validated by Zod at write |
| footer_text | text | nullable |
| updated_at | timestamptz | not null |
| updated_by_staff_id | uuid | FK → staff_users.id |

**Singleton:** enforced via a `CHECK (id = '00000000-0000-0000-0000-000000000001')` sentinel like `global_policy`. Read by `GET /api/v1/public/marketing` (no auth, cacheable). Edited at `PATCH /api/v1/portal/admin/marketing`.

### 4k. Operations

#### `feature_flags`

Lets us dark-launch deferred features (e.g. waitlist) and toggle non-critical surfaces without redeploying.

| Column | Type | Notes |
|---|---|---|
| key | text | PK — e.g. `waitlist_enabled` |
| enabled | boolean | not null, default `false` |
| updated_at | timestamptz | not null, default now() |
| updated_by_staff_id | uuid | FK → staff_users.id |

The prior `promo_codes_enabled` flag is **removed**. Promotions (per `fe-client-features.md` §6.1, `admin-restructure.md` §5d, §19) are launch-day functionality modelled directly in the `promotions` table (§4d). Promo Codes — the surface where a member types a code — are their own tables and their own service (`spec-pre-launch-batch.md` §9–§11, migration `0016`), and are a distinct mechanism from the `promotions` table rather than a variant of it.

**Read pattern:** `lib/feature-flags-cache.ts` loads all rows at boot into an in-memory map; admin toggle (`PATCH /api/v1/portal/admin/feature-flags/:key`) updates DB + invalidates cache (process-local — multi-instance deploys would need a pub/sub trigger, deferred).

**Subsumed tables (drop during reshape).** The existing `/be` scaffolding had `cancellation_requests` and `refund_requests` tables modelling an admin-approval workflow. These are not used in v1 — the spec's automated cancellation flow + `inbox_items` (for any actionable cases) cover the same surface area without introducing an admin-resolution queue. Drop both tables when reshaping the schema.

### 4l. Inbox (§13)

#### `inbox_items`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| type | enum | `client_cancellation`, `admin_cancel_class_pt`, `admin_cancel_workshop` |
| payload | jsonb | denormalised display data — keys vary by type, validated by Zod at insert time |
| read_at, read_by_staff_id | | nullable |
| created_at | timestamptz | not null |

**Indexes:** `(type, read_at, created_at desc)` for filter + unread count.

**PT requests are no longer Inbox items.** Per `admin-restructure.md` §13, PT request triage moved to its own dedicated page (`/admin/pt-requests`) backed by the `pt_requests` table (§4e). The Inbox is now purely a read-only notification feed — the `action_taken` / `action_at` / `action_by_staff_id` / `source_pt_session_id` columns were dropped along with the `pt_request` type value.

**Payload schemas (Zod, validated at write):**
- `client_cancellation` → `{ client_id, client_name, session_kind, session_id, session_label, cancelled_at, refund_result }`
- `admin_cancel_class_pt` → `{ actor_staff_id, actor_name, session_kind, session_id, session_label, cancelled_at, clients_refunded }`
- `admin_cancel_workshop` → `{ actor_staff_id, actor_name, workshop_id, workshop_name, cancelled_at, total_refunded_sgd, attendees_refunded }`

---

## 5. Background Jobs

**v1 strategy:** `node-cron` for non-critical periodic jobs (in-process, no Redis dependency). The durable BullMQ queue is added when the Stripe refund flow goes live, since refund retries need durability across process restarts. Until then, refund automation runs synchronously inside the cancel-workshop request handler with explicit error logging.

### `node-cron` schedulers (in-process)

| Job | Schedule | Handler |
|---|---|---|
| `email` send | Triggered (not scheduled) — invoked by any service via `services/notifications/send.ts:enqueueEmail()`, executed inline against the SMTP transport | Render template + variables → `lib/mailer.ts` (Nodemailer) → write `email_log`. In v1 this is synchronous (no queue); failures are logged and surfaced in `email_log.status='failed'` with `error` populated from the Nodemailer rejection |
| `checkin-nag` | Daily 03:00 SGT (`node-cron`) | Find sessions where `ends_at` between now-25h and now-23h AND any booking has `check_in_state='pending'` → send `checkin_nag` email to assigned instructor (cc admin), one per session |
| `credit-expiry` | Daily 03:00 SGT (`node-cron`) | Find `client_packages` where `expires_at` between now+6.5d and now+7.5d → send `credit_expiry_reminder` email. The renderer has no conditionals, so the kind branch happens in code: `remaining_line` is composed with `notifications/purchase-email.ts:contentsLine`, which says "2 classes" for a trial and "2 class credits" for a bundle. |
| `pt-request-expiry` | Hourly (`node-cron`) | Find `pt_requests WHERE status='pending' AND expires_at < now()` → update `status='expired'`, set `resolved_at=now()`, `resolved_by_staff_id=NULL`, then `enqueueEmail('pt_request_expired', client.email, …)`. Stale requests must not linger in the admin queue. |
| `promotion-status` | Not a cron — **query-time derivation**. A `promotions` row is "active right now" iff `status='active' AND now() BETWEEN starts_at AND ends_at`. Computed in `services/promotions/resolve.ts:bestPriceFor(parent_type, parent_id)`. No background sweep needed; the windowed predicate is cheap given the `(parent_type, parent_id, status, starts_at, ends_at)` index. | — |
| Workshop admin-cancel refunds | Triggered (not scheduled) by admin route | For each booking in workshop: call Stripe Refund API → on success, update booking `state='cancelled'`, `refund_outcome='stripe_refunded'`; emit one inbox item for the workshop. **v1: synchronous.** **Future: BullMQ with idempotency key = booking_id.** |
| Workshop waitlist promote | **Deferred — not in v1.** Slug `workshop_waitlist_promoted` is seeded so the template editor surfaces it. When waitlist behaviour lands, this becomes a triggered handler on booking-cancel that picks the oldest waitlist row for each affected day and offers it. | — |

### BullMQ (added when refund durability is required)

| Queue | Trigger | Handler |
|---|---|---|
| `stripe-refund` | Workshop admin-cancel route enqueues one job per booking | Worker calls Stripe Refund API; idempotency key = booking_id. Replaces the synchronous v1 path. |
| `stripe-refund` | Workshop admin-cancel route | For each booking in workshop: call Stripe Refund API → on success, update booking `state='cancelled'`, `refund_outcome='stripe_refunded'`; emit inbox item once for the workshop |

**No `flip-event-state` job.** Event state is computed at read time by `services/policy/event-state.ts`.
**No `cycle-reset` job.** Cancellation cap is computed dynamically in `services/policy/evaluate-cancellation.ts` from `cancellations` table filtered by `cancelled_at >= now() - cycle_days`.

Idempotency keys on `stripe-refund` jobs (booking_id) prevent double refund on retry.

---

## 6. External Integrations

### 6a. Auth (Better Auth, self-hosted)

See `docs/adr/0004-self-hosted-auth-with-better-auth.md` for the decision.

- **Three pools.** `client` (members, email + password, first password through a mailed link — `docs/adr/0005-member-passwords.md`), `staff` (studio portals, email + password + second factor), `platform` (the super portal). Each is its own Better Auth instance over its own tables (`db/schema/auth.ts`) on its own base path `/api/v1/auth/{pool}` — enforces §15b "staff and client spaces are independent." One `BETTER_AUTH_SECRET` signs all three.
- **Bearer, not cookies.** A session travels as `Authorization: Bearer <token>`, returned in the `set-auth-token` header and held per origin by the frontend.
- **The session carries its Tenant.** A `client` or `staff` session is stamped at sign-in with `claimed_tenant_id`; `clientAuth` / `staffAuth` refuse it at any other studio. The auth user tables carry no `tenant_id` — one person is one auth user with a row per studio.
- **Identity glue.** `clients.auth_user_id` and `staff_users.auth_user_id` (both `NOT NULL`) link our rows to pool users. We own profile + role + relationships; the pool owns credentials, sessions and 2FA.
- **No sign-up for staff, no webhooks.** A staff account exists because an invitation (`services/auth/invitations.ts`) or a seed wrote it, together with its `staff_users` row; the invitee sets a password through our own token link. A member's account and `clients` row are written together at registration (`services/clients/register.ts`).
- **Force-logout on archive** (§15c) — archiving deletes the person's sessions at that studio (`endStaffSessionsAt` / `endClientSessionsAt`); the same account stays signed in at any other studio.
- **Pre-booking verification gate.** `fe-client-features.md` requires `phone_verified` AND `email_verified` before booking. Not built: the emailed-code sign-in already proves the email; phone verification has no source yet.

### 6b. Stripe

- **Payment Intents only** in v1 (no Checkout Sessions, no Subscriptions). Backend creates intent → returns `client_secret` → fe confirms with Stripe.js.
- **`payment_intent.succeeded` webhook** → `billing/grants.ts`:
  - kind=`class_package` or `pt_package` → insert `client_packages` row
  - kind=`workshop` → insert `bookings` row (workshop_id + workshop_tier_id + state=`confirmed`)
  - kind=`corporate_package` → insert **no** `client_packages` row; instead auto-create ONE `corporate_requests` row (status=`pending`, `client_id`, `corporate_package_id` from the intent metadata). The pending request is the entitlement; scheduling happens via the portal (`be-portal.md` §3f). The `checkout.session.completed` path carries the same effect for the corporate branch.
  - Always insert `stripe_payments` row with `status='succeeded'`
- **Workshop admin-cancel** (§7a) → enqueue one `stripe-refund` job per booking in workshop. Worker calls Stripe Refund API. `charge.refunded` webhook closes the loop.
- **Free workshops** (`workshop_tiers.regular_price_sgd = 0`) skip Stripe entirely. Booking flow inserts a `bookings` row with `kind='workshop'`, `state='confirmed'`, `purchase_id = null`, and **no** `stripe_payments` row is created. The receipt UI on fe-client suppresses the Download link when `receipt_url` is null.
- **Idempotency.** Stripe's event IDs are deduplicated against `stripe_payments.payment_intent_id` (and a separate `stripe_webhook_events` table for raw event de-dupe — minor, can add later).
- **Each studio may charge on its own account (#100).** Every provider call goes through one Tenant-bound accessor, `stripeForTenant` (`be/src/lib/stripe.ts`), and `providerAccountForTenant` is the single place that answers which account it is on: the studio's own credentials when it has supplied them (§4i `tenant_payment_credentials`), otherwise `null` — the platform's account, where a studio that has supplied none still sells. A studio on its own account sends **no statement descriptor suffix**, because the 22-character limit is measured against that account's own prefix, which this platform cannot read.
- **Webhooks, two endpoints.** `/api/v1/webhooks/stripe` is the platform account's, verified with `STRIPE_WEBHOOK_SECRET`, and the studio is worked out afterwards from the signed body. `/api/v1/webhooks/stripe/{slug}` is a studio's own: its account signs with its own secret, so the studio has to be settled **before** the signature can be checked, and the URL is the only part of a delivery fixed before the body is read. Exactly one secret is tried — no fallback to the platform's, no sweep of every studio — and the tenant the URL named is carried into the handler, which refuses any event whose body routes elsewhere (`refuseWrongTenant`). Every refusal on that endpoint is the same flat 400, so a URL cannot be used to enumerate which studios take their own money.
- **Known gap, observed but not fixed by `spec-pre-launch-batch.md`:** if the payment provider's own automatic receipt emails are switched on in the dashboard, a paid purchase produces two emails — ours, the branded one carrying the QR code and the activation sentence, and theirs, a bare payment record. Confirm this setting is off before go-live; nothing in the code prevents it either way.

### 6c. Cloudflare R2

- S3-compatible. `@aws-sdk/client-s3` with R2 endpoint and credentials.
- **One bucket** (`R2_BUCKET_NAME`, optional in env like the rest of the storage settings), served by `R2_PUBLIC_URL`. It holds workshop covers, instructor photos **and** instructor Supporting Documents.
- **Everything in it is public.** An object is readable by anyone who holds its key, with no expiry. There is no private bucket: `R2_PRIVATE_BUCKET_NAME` existed briefly and was removed. Read this before you put anything else in here.
  - For a Supporting Document the key is the only protection, which is why `supportingDocumentKey` is `supporting-documents/{instructorId}/{requestId}.{ext}` — two UUIDs — and why no read path serialises it. That is obscurity, not access control. Splitting the documents back into a bucket with public access disabled is the fix if this is ever judged insufficient. Objects written before the rename keep their `medical-certificates/…` path: the key is stored per request, never recomputed.
- **Two upload flows.** Which one applies is a property of the caller, not of the bucket.
- **Imagery — presigned PUT (intended, not yet built).** Backend issues presigned PUT URL with content-type and 5 MB cap → fe uploads directly → fe POSTs the returned key back to backend, backend stores in `instructors.photo_r2_key` / `workshops.cover_r2_key` / `workshop_images.r2_key`. No code writes these keys yet; instructor photo upload is deferred (`spec-instructor-leave.md` Out of Scope).
- **Supporting Documents — server-side upload (implemented).** The file is POSTed to the API as multipart, field `file` (`POST /portal/instructor/leave/:id/document`), and is accepted on a medical or study request and never on an annual one → Hono's `bodyLimit` refuses an oversized body before it is buffered at all → the service validates the declared content type and the *real* byte length against the allow-list (`image/jpeg`, `image/png`, `application/pdf`; 5 MB) → `lib/r2.ts#putObject` writes the object → the key is written to `leave_requests.supporting_document_r2_key` only once the object is safely in the bucket.
  - **Why this one is not presigned.** Type and size are checked at a trust boundary the server controls rather than announced to a browser.
- **Supporting Document reads — signed GET.** `lib/r2.ts#signedObjectUrl` mints a 5-minute signed URL per request, generated on demand and never stored, after the service has decided the caller may see the row (the owning instructor, or any admin). On a public bucket the expiry is a courtesy: the same object is reachable unsigned through `R2_PUBLIC_URL`.

### 6d. Mail (Resend)

- **Transport.** `lib/mailer.ts` constructs one Resend client at boot from `RESEND_API_KEY`. One envelope address in the domain verified on Resend, the constant `noreply@reservetoday.app`, for members and staff alike. Every send passes through one in-process send gate (`lib/send-gate.ts`): paced under Resend's team rate limit, credential mail (codes, resets) ahead of everyday mail, bounded retries on rate-limit / 5xx / network failures, no retry on quota refusals, an idempotency key and `kind` / `template` / `tenant` tags on every message. A Tenant's display name and `Reply-To` are applied per send (`docs/md/mail-identity.md`). Under `NODE_ENV=test` a null transport accepts and discards every message.
- **Provider swap** is confined to the `MailTransport` interface in `lib/mailer.ts`; callers see `sendMail()` only.
- **Server-side rendering** via `services/notifications/render.ts`:
  - Parse template body for `{{variable}}` tokens
  - Validate against `services/notifications/variables.ts` allow-list per slug (this is what powers the §17c amber flag in fe — same source of truth)
  - Substitute values; sanitise (XSS safe — rich text from admin trusted, but variables themselves escaped)
- **Logging.** One `email_log` row per recipient per send. On send success, store Resend's email `id` in `smtp_message_id` (column name kept from the SMTP era; `smtp_response` is now always null). On a refused send, store the error in `error` and set `status='failed'`.
- **No bounce webhook.** Resend exposes `email.bounced` / `email.complained` webhooks; v1 does not consume them. Add as a route under `routes/webhooks/` later — out of scope for v1.
- **Testing.** Local dev uses `SMTP_HOST=localhost` + `mailpit` or `mailhog` running on port 1025; staging uses the production provider with a sandboxed sender domain.

---

## 7. Cross-Cutting

### Cancellation evaluation (§4)

`services/policy/evaluate-cancellation.ts` — pure function:

```
input:  { clientId, kind: 'class' | 'pt', sessionStartsAt, now }
reads:  cancellations (count where client_id=X AND source='client' AND cancelled_at >= now - cycle_days),
        global_policy
output: { allowed: true,            // always true per §4
          refund: 'full' | 'forfeit',
          reason: 'within_window_within_cap' | 'over_cap' | 'late' | 'late_and_over_cap' }
```

Used by `services/bookings/cancel.ts` (client path). Admin path bypasses this — always full refund.

**This is a credit/session refund, not a Refund.** The word means two different things in this codebase and the glossary (`be/CONTEXT.md` § Refunds) is binding: what this function returns is a cancelled booking's credit or session going back to a package that still exists. The money-back **Refund** below is a different action entirely.

### Purchase Refunds (§14)

`services/billing/refunds.ts` — a Refund voids the purchase it paid for, cancels every future booking on it, and hands any Promo Code redemption back. There is no partial refund and no separate admin revoke; the full amount is the only amount.

`issueRefund()` is the portal button (`routes/portal/admin/clients.ts POST /clients/:id/packages/:packageId/refund`, admin, mandatory typed reason): it calls `stripe.refunds.create` and returns — nothing is unwound here. `unwindRefund()`, driven entirely by the `charge.refunded` webhook, does all of it: stamps `stripe_payments.status='refunded'`, sets `client_packages.active=false` (the same lever the nightly expiry sweep already pulls), cancels every future booking the purchase paid for through the existing cancel service (`source: 'admin'`, so waitlist promotion comes free), and returns the redemption row to `refunded` (not deleted — the ledger is the only record of a buy-refund-buy loop). Because the dashboard route and the button route both resolve to the same webhook, **a refund issued from Stripe's own dashboard unwinds identically to one issued from the portal** — the two are indistinguishable by construction, and every step is a no-op on a second delivery.

Eligibility is a notice, not a gate: `refundStatesFor()` computes whether a purchase is **Untouched** (no booking on it attended or no-showed) and the portal shows a warning above the button when it is not, but the button stays clickable — the override is recorded on the audit row rather than blocked by the database.

Scope: class packages, PT packages and workshops. A refunded workshop payment cancels its booking via the payments ledger's existing booking link — `unwindRefund` branches on whether the payment row has a `bookingId` (workshop) or a `clientPackages` row (everything else); corporate creates neither, so a corporate payment refunded from the dashboard is recorded and nothing else moves. The Cross-Location Add-On has no independent refund — it dies with the plan it's a column on.

**A workshop purchase has its own portal button, reusing the same path.** A workshop's booking IS the purchase, so it carries no `client_packages` row and — before this shipped — never appeared beside the package rows the button lived on. `issueWorkshopRefund()` (`services/billing/refunds.ts`) shares its provider call with `issueRefund()` and stops there, same as the package path; the already-workshop-aware `unwindRefund()` does the rest, so a workshop refund from the portal and one from the provider's dashboard stay indistinguishable by construction. The client detail page now lists workshop purchases as their own rows with the same button, dialog and attended notice as a package row.

The member is told with a new `purchase_refunded` slug, composed the same way the four purchase-confirmation emails are (`be-client.md` §4e) — the provider's own receipt says money moved; this one names the classes that were cancelled.

### Audit middleware

Mounted on `/api/v1/portal/*` with method in `(POST, PUT, PATCH, DELETE)`. Captures `(actor_staff_id, action_inferred_from_route, target_table, target_id, payload)` and inserts into `audit_log` after the route handler succeeds. Services can also write directly for cron / webhook events (`actor_type='system'`).

### Event state (§11)

`services/policy/event-state.ts` — pure function over `(starts_at, ends_at, lifecycle, now)`. Called by every read endpoint that returns schedule entities. The fe never persists this; backend never stores this.

### Per-booking codes (§11)

On booking creation, `services/bookings/qr.ts:generateBookingCodes()` returns:
- `qr_token` — 32-byte URL-safe random; encoded into QR, not human-readable.
- `code` — `RT-` + **6 Crockford base32** characters (the prefix is the platform's, not a studio's; codes issued before the rename keep `YS-` and remain valid, since lookup matches the whole string) (alphabet: `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, omitting `I`, `L`, `O`, `U` to prevent visual ambiguity). Uniqueness enforced via DB unique index. Stored uppercase; lookup uppercases input and treats `0`↔`O` and `1`↔`I/L` as the same char (defensive against manual entry typos).

Example: `RT-A4F2K9`. Collision probability over 10⁶ bookings on a 32⁶ ≈ 10⁹ space is ~5e-4; uniqueness retry loop handles the rare collision.

Both index into `bookings` directly — no "wrong session" possible.

### Capacity enforcement

- **Class:** booked count = `count(bookings WHERE class_id = X AND state = 'confirmed')`. Enforced at book-time (service-layer transaction with `SELECT ... FOR UPDATE` on the class row).
- **Workshop tier:** booked count = `count(bookings WHERE workshop_tier_id = X AND state = 'confirmed')`. Same lock pattern on tier row.

### Timezone

All timestamps stored UTC. `lib/time.ts` exposes SGT (`Asia/Singapore`) helpers for: cycle anchors, day-boundary edge cases (e.g. "7 days before expiry" calculated in SGT), schedule cron timing.

### Referral conversion crediting

Per `fe-client-features.md`: when a referee makes their **first paid** booking (workshop) or package purchase, the referrer earns a S$20 credit. Implementation uses existing primitives plus a single dedupe column.

**Schema add (small):** `clients.referral_credit_granted_at timestamptz nullable` — non-null means we have already credited the referrer for this referee.

**Flow (`services/referrals.ts:onRefereeFirstPayment(refereeClientId)`)**, called from `services/billing/webhook-handler.ts` inside the same transaction as the package grant or workshop booking insert:

1. Load referee row. Skip if `referred_by_client_id IS NULL` (no referrer) or `referral_credit_granted_at IS NOT NULL` (already credited).
2. Pick the referrer's most recent active `client_packages` row (`kind in ('credit_bundle','unlimited')`, `expires_at > now()`). If none exists, insert a 90-day "referral credit" `client_packages` row with `kind='credit_bundle'`, `credits = 20 / standard_credit_value_sgd`, `amount_paid_sgd = 0`, `purchase_id = NULL`.
3. Insert `manual_adjustments` row: `client_id = referrer`, `client_package_id = chosen`, `delta = credits granted`, `reason = 'referral_conversion'`, `acted_by_staff_id = NULL`.
4. Update referee: `UPDATE clients SET referral_credit_granted_at = now() WHERE id = referee`.
5. Write `audit_log` row: `actor_type='system'`, `action='referral.converted'`, target = referrer's `clients.id`.
6. Send referrer an email (template slug `referral_credited` — add to the seeded list in §17b alongside the existing 21).

**Idempotency:** the `referral_credit_granted_at` UPDATE in step 4 is inside the webhook transaction. On retry, step 1 short-circuits because the column is now non-null. No double-grant possible.

The "first paid" gate is implicit: the referee's first successful Stripe payment is the only event that runs this code, since steps 1–6 are guarded by `referral_credit_granted_at IS NULL`.

### Migrations

`drizzle-kit generate` → SQL committed to `db/migrations/` → `drizzle-kit migrate` on deploy. Migrations only add; a rename or drop is expand → backfill → contract across deploys — the rule and why are in `be/src/db/migrations/README.md` § Golden rules.

### Seed (`db/seed/`)

Run idempotently on fresh deployment:
- **email-templates.ts** — inserts the 22 templates with default subject + body
- **waiver.ts** — inserts the singleton waiver row with placeholder body
- **policy.ts** — inserts singleton `global_policy` and `pt_booking_config` with sensible defaults

---

## 8. Phase Boundaries

**This phase (in scope):**
- All schema in §4 (including amendments: `clients.gender`/`dob`, `marketing_content`, `stripe_payments.receipt_url`, `feature_flags`, **`promotions`**, **`workshop_days`** + **`workshop_tier_days`**, **`pt_requests`** split out from `pt_sessions`, **`class_packages.kind='trial'`** + one-trial-per-client partial unique index, decomposed capacity on `classes` / `workshop_days` / `pt_sessions`).
- All routes in §2: `routes/portal/admin/*`, `routes/portal/instructor/*` (read-only views), `routes/client/*`, `routes/public/*`, `routes/webhooks/*`.
- All cron handlers in §5 (run via `node-cron`), including the new **`pt-request-expiry`** hourly sweep.
- Referral chain populated AND reward-grant logic wired (see §7 Referral conversion crediting).
- **Promotions** (admin-published, best-price-wins resolved at purchase) — see §4d `promotions`. **Promo Codes** (typed by the member, crossing products, capped) ship separately in migration `0016` — see `spec-pre-launch-batch.md` §9–§11.
- **Trial Pass** as a first-class `class_packages.kind` with server-enforced one-per-client.
- **Multi-day workshops** with derived tier capacity and per-day waitlist scaffolding (waitlist *promotion* behaviour itself remains deferred).
- **Workspace scoping** — selected-location filter on all workspace-scoped portal reads.
- `audit_log` table populated; admin-facing read views deferred.

**Next phase (per `admin-restructure.md` §19):**
- Reports module — read-only aggregate queries over existing tables.
- Audit log surfacing UI — table populated this phase; read endpoints + admin views deferred.
- ~~Instructor self-service availability~~ — Availability system removed entirely in v1 (§4f); PT scheduling is conflict-checked at admin-approve time. If a stored availability calendar is reintroduced later, it lands as a new feature, not a reactivation.
- Dashboard — read-only metric aggregates.
- BullMQ + Redis for durable Stripe refund retries — `node-cron` handles non-critical jobs in v1; the refund queue lands when refund automation is fully wired.

**Out of scope for v1 (gated by `feature_flags` if needed):**
- ~~Typed promo codes at checkout.~~ **Superseded — Promo Codes ship.** See `spec-pre-launch-batch.md` §9–§11 and migration `0016`. The model built is **not** the one sketched here: there is no used-count on the code row (a second source of truth that drifts) and no valid-from window (a code does nothing until someone hands it out; `archived` covers "made, not yet running"). Three tables — `promo_codes`, `promo_code_products` (scope, no FK on `product_id`), `promo_code_redemptions` (the ledger, one row per member per code) — with the rules in `services/packages/promo-codes.ts` and admin CRUD in `services/packages/promo-code-admin.ts`. A Promo Code is typed and crosses products; a **Promotion** (§4d) applies itself to one product inside a window. The two are distinct mechanisms and `be/CONTEXT.md` § Discounts is the glossary. Redeeming a code at checkout is wired separately.
- **Class waitlist.** `fe-client-features.md` §Booking Rules mentions "Full → Join Waitlist" with seat-available email + time-bound claim CTA. v1 UI shows "Full" with no waitlist CTA. If kept later: add `waitlist_entries (client_id, class_id|workshop_tier_id, joined_at, offered_at, offer_expires_at, status=waiting|offered|claimed|expired|cancelled)`.
- **WhatsApp / SMS / push notifications.** Email-only in v1.
- ~~**Multi-tenant SaaS surface.** This backend serves one studio exclusively; no tenant scoping.~~ **Superseded — multi-tenancy shipped.** `tenant_id` on all 55 domain tables, Row-Level Security as the fail-closed backstop, hostname-resolved Tenants, and no studio named anywhere in the repo. See `multi-tenancy-plan.md`, `spec-tenant-resolution.md` and `docs/adr/0002-shared-schema-row-level-security.md`. What is still out of scope is the **plan/billing** layer for studios.

---

## 9. Open Questions

1. **Postgres host** — Neon (branching), Supabase Postgres, RDS, or self-hosted?
2. **Redis host for BullMQ** — Upstash (serverless-friendly) or self-hosted?
3. **Deployment target** — Fly.io / Railway / Render are good fits for both HTTP + worker. Vercel is HTTP-only (no long-lived worker).
4. **Email rendering** — React Email (rich JSX templates) or plain HTML with `{{var}}` substitution? React Email is nicer DX but adds a build step.
5. **Stripe webhook event de-dupe** — add `stripe_webhook_events` table now, or rely on `stripe_payments.payment_intent_id` uniqueness?
