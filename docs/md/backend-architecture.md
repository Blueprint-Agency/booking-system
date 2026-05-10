# Backend Architecture — Yoga Sadhana

The structural spine for the Yoga Sadhana backend (`/be`). Stack, folder structure, database schema, external integrations, jobs, and shared cross-cutting infrastructure live here. Per-audience surface (routes, endpoints, business flows) lives in two sister docs:

- **`be-portal.md`** — staff backend (admin + instructor scopes), maps `admin-restructure.md` behaviour onto routes/services.
- **`be-client.md`** — client backend (`/me/*` and public reads), maps `fe-client-features.md` behaviour onto routes/services.

The single backend serves **both** `fe-portal` and `fe-client`. `fe-portal` is the staff app (admin + instructor views) using one Clerk staff app; `fe-client` is the client app using a separate Clerk app. URL prefixes:

- `/api/v1/public/*` — unauthenticated reads (catalog, marketing, referral resolve)
- `/api/v1/me/*` — client Clerk app (see `be-client.md`)
- `/api/v1/portal/admin/*` and `/api/v1/portal/instructor/*` — staff Clerk app (see `be-portal.md`)
- `/api/v1/webhooks/*` — Clerk + Stripe signed webhooks

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
| Background jobs | **`node-cron`** for non-critical periodic jobs (reminders, expiry sweeps); **BullMQ** (Redis-backed) added when the durable refund flow lands. Until then, no Redis dependency. |
| Email | **SMTP via Nodemailer** (transactional, 22 templates per §17). Provider-agnostic — host/port/credentials via env vars (e.g. AWS SES SMTP, Gmail relay, Mailgun SMTP, self-hosted Postfix). |
| Payments | **Stripe** (Payment Intents + Refund API; no Subscriptions in v1) |

---

## 2. Folder Structure

The layout splits **routes by audience** (single-owner folders → minimal merge collisions between the two devs working in parallel) and **services by feature** (one source of domain rules → admin force-cancel and client self-cancel hit the same `services/bookings/cancel.ts`, so policy can't drift between flows).

Top-level audience split is **portal vs client vs public vs webhooks**. `portal/` groups admin + instructor since they share the staff Clerk app and a single `staff_users` identity (role differentiates at middleware). `client/` is the separate client Clerk app.

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
    │   │   ├── catalog.ts             # locations, class_types, instructors, instructor_class_types
    │   │   ├── policy.ts              # global_policy, pt_booking_config (singletons)
    │   │   ├── packages.ts            # class_packages, pt_packages, client_packages
    │   │   ├── schedule.ts            # classes, workshops, workshop_tiers, workshop_images,
    │   │   │                          #   workshop_instructors, pt_sessions, pt_session_clients
    │   │   ├── availability.ts        # instructor_availability_recurring, _oneoff
    │   │   ├── bookings.ts            # bookings, cancellations, check_ins
    │   │   ├── ratings.ts             # ratings
    │   │   ├── ledger.ts              # manual_adjustments, audit_log, stripe_payments
    │   │   ├── content.ts             # email_templates, email_log, waiver, waiver_signatures, marketing_content
    │   │   ├── inbox.ts               # inbox_items
    │   │   ├── ops.ts                 # feature_flags
    │   │   └── relations.ts           # All Drizzle `relations()` declarations
    │   ├── seed/
    │   │   ├── run.ts                 # Orchestrator (idempotent)
    │   │   ├── superadmin.ts          # Bootstrap initial superadmin from SUPERADMIN_EMAIL env
    │   │   ├── email-templates.ts     # Seed 22 default templates per §17b
    │   │   ├── waiver.ts              # Seed placeholder waiver body per §18a
    │   │   ├── marketing.ts           # Seed marketing_content singleton with placeholder copy
    │   │   └── policy.ts              # Seed defaults: global_policy, pt_booking_config
    │   └── migrations/                # drizzle-kit-generated SQL
    │
    ├── routes/                        # Audience-split — single-owner folders
    │   ├── portal/                    # Staff Clerk app (admin + instructor share `staff_users`)
    │   │   ├── index.ts               # Mounts /admin and /instructor under shared staff auth
    │   │   ├── admin/                 # Owned by fe-portal dev — gated by require-role('admin'|'superadmin')
    │   │   │   ├── index.ts           # Mounts all admin routers
    │   │   │   ├── locations.ts
    │   │   │   ├── class-types.ts
    │   │   │   ├── instructors.ts     # CRUD + archive/restore + invite
    │   │   │   ├── policy.ts          # read + update singletons
    │   │   │   ├── class-packages.ts  # CRUD (§5)
    │   │   │   ├── pt-packages.ts     # CRUD (§6)
    │   │   │   ├── schedule.ts        # class + workshop create/edit + admin-cancel (§7)
    │   │   │   ├── availability.ts    # set on behalf of instructors (§8)
    │   │   │   ├── pt-sessions.ts     # approve / decline / cancel
    │   │   │   ├── bookings.ts        # admin cancel + roster
    │   │   │   ├── check-in.ts        # generic page + per-session (§11)
    │   │   │   ├── inbox.ts           # list, mark read, approve/decline PT (§13)
    │   │   │   ├── ratings.ts         # read all (full attribution, §14)
    │   │   │   ├── clients.ts         # list, profile, status toggle, adjustments (§16)
    │   │   │   ├── staff.ts           # list, invite, revoke, archive, resend invite (§15)
    │   │   │   ├── notifications.ts   # email template editor (§17)
    │   │   │   ├── waiver.ts          # edit waiver text + signed count (§18)
    │   │   │   ├── marketing.ts       # edit hero / pricing / footer copy
    │   │   │   └── feature-flags.ts   # toggle ops flags
    │   │   └── instructor/            # gated by require-role('instructor'|'admin'|'superadmin')
    │   │       ├── index.ts
    │   │       ├── schedule.ts        # own schedule view
    │   │       ├── roster.ts          # own session rosters
    │   │       ├── check-in.ts        # own (QR + code + manual)
    │   │       ├── pt-requests.ts     # PT requests for own sessions
    │   │       ├── availability.ts    # own (next phase — admin sets in v1)
    │   │       ├── profile.ts         # own bio / photo
    │   │       └── ratings.ts         # own (anonymised in service)
    │   │
    │   ├── client/                    # Owned by fe-client dev — client Clerk app + require-active
    │   │   ├── index.ts               # Mounts all client routers under /api/v1/me
    │   │   ├── me.ts                  # profile, dashboard (§16, fe-client /account)
    │   │   ├── catalog.ts             # browse classes, workshops, packages, instructor availability for PT picker
    │   │   ├── bookings.ts            # book + cancel + view own + QR
    │   │   ├── pt-sessions.ts         # submit request + view own + cancel
    │   │   ├── purchases.ts           # initiate Stripe checkout (package or workshop)
    │   │   ├── invoices.ts            # list, filter, receipt link
    │   │   ├── ratings.ts             # submit + edit own + read attended
    │   │   ├── waiver.ts              # read for sign + sign endpoint
    │   │   └── referral.ts            # own referral code + conversion stats
    │   │
    │   ├── public/                    # Unauthenticated reads — no Clerk required
    │   │   ├── index.ts
    │   │   ├── catalog.ts             # locations, classes, workshops, packages (browse)
    │   │   ├── marketing.ts           # hero / testimonials / pricing blurb / footer
    │   │   └── referral.ts            # GET /referral/by-code/:code — resolve at register
    │   │
    │   └── webhooks/                  # Public endpoints with vendor signature verification
    │       ├── index.ts
    │       ├── clerk.ts               # user.created/updated → upsert clients or staff_users
    │       └── stripe.ts              # payment_intent.succeeded → grant; charge.refunded → mark
    │                                  # (no SMTP bounce webhook — failures captured via Nodemailer rejection in email_log)
    │
    ├── services/                      # Per-feature — jointly owned, single source of domain rules
    │   ├── bookings/
    │   │   ├── book.ts                # Class book (capacity + credit deduct in tx)
    │   │   ├── cancel.ts              # Cancel flow (client + admin paths) — calls services/policy
    │   │   ├── refund-outcome.ts      # Decide credit_returned | session_returned | stripe_refunded | forfeited
    │   │   └── qr.ts                  # `generateBookingCodes()` → { qrToken, code }
    │   ├── workshops/
    │   │   ├── publish.ts             # Validate tiers + images + instructors on create/update
    │   │   └── refund-fanout.ts       # Workshop admin-cancel → enqueue stripe-refund per booking
    │   ├── pt-sessions/
    │   │   ├── request.ts             # Submit + insert inbox_item
    │   │   ├── approve.ts             # Confirm + book + email
    │   │   └── cancel.ts
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
    │   │   ├── invitations.ts         # Token issue + Clerk invitation API call
    │   │   └── webhook-sync.ts        # Clerk user.* → upsert clients or staff_users
    │   ├── clients/
    │   │   ├── profile.ts             # GET/PATCH self profile
    │   │   ├── dashboard.ts           # Next-up + balances aggregation
    │   │   └── admin-views.ts         # List + detail aggregations for admin clients page
    │   ├── inbox.ts                   # Insert / mark read / resolve action
    │   ├── ratings.ts                 # Submit + edit + view-scoping anonymisation
    │   ├── waiver.ts                  # Read singleton + sign
    │   ├── marketing.ts               # Read + update marketing_content
    │   ├── referrals.ts               # Code generate + conversion grant via manual_adjustments
    │   └── feature-flags.ts           # Read (cached) + toggle
    │
    ├── middleware/
    │   ├── clerk-client.ts            # Verify client Clerk JWT → load `clients` row → ctx.client
    │   ├── clerk-staff.ts             # Verify staff Clerk JWT → load `staff_users` row → ctx.staff
    │   ├── require-role.ts            # Factory: `requireRole('admin' | 'superadmin' | 'instructor')`
    │   ├── require-active.ts          # Block suspended clients / archived staff
    │   ├── impersonate.ts             # Superadmin acts-as admin (sets ctx.actingAs + audit)
    │   ├── audit.ts                   # Auto-write audit_log on mutating staff requests
    │   ├── validate.ts                # `@hono/zod-validator` wrapper conventions
    │   ├── rate-limit.ts              # Hono rate-limiter (public + authenticated tiers)
    │   ├── error.ts                   # AppError → HTTP mapping
    │   └── request-id.ts              # Trace ID per request
    │
    ├── lib/
    │   ├── clerk.ts                   # Two Clerk SDK instances (client + staff app keys)
    │   ├── stripe.ts                  # Stripe SDK + signed webhook verification
    │   ├── r2.ts                      # S3 client + presigned URL helpers
    │   ├── mailer.ts                  # Nodemailer SMTP transport (host/port/auth from env) + send wrapper
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

The `portal/*` prefix mirrors the staff Clerk app boundary: one auth gate for both admin and instructor; role-specific gates added per sub-router. Cross-app tokens (client JWT presented to `/portal`, staff JWT to `/me`) are rejected at the `clerkStaffAuth` / `clerkClientAuth` middleware.

**Hard rule for every route file:** `auth → zod parse → call service → format response`. Business logic lives in `services/<feature>/*`, not in route files. This is what lets admin and client share the same domain rules without drift.

Per-audience endpoint enumeration, mount internals, middleware stacks, and business flows are documented in:

- **`be-portal.md`** — staff Clerk auth (admin + instructor), endpoint tables per route file, portal-driven flows (staff invitations, schedule create, admin cancel + refund fanout, manual adjustments, PT approval, inbox, etc.).
- **`be-client.md`** — client Clerk auth + verification gate, public reads, client endpoints, client-driven flows (registration, booking, self-cancel, purchases, referral conversion, ratings).

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
| clerk_user_id | text | unique, not null — from client Clerk app |
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

**Indexes:** `(clerk_user_id) unique`, `(email) unique`, `(status)`, `(referred_by_client_id)`, `(lower(name))` for case-insensitive search.

**Phone/email verification state — not stored.** Pre-booking verification (`half-verified → fully verified` per `fe-client-features.md`) is enforced by reading `phone_verified` / `email_verified` claims from the Clerk session token at request time. We do not duplicate verification state on `clients`.

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
| code | text | unique, not null — `YS-` + 6 Crockford-base32 chars (e.g. `YS-A4F2K9`); see §7 Per-booking codes for alphabet + lookup rules |
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

id, payment_intent_id (text unique), amount_sgd, kind enum (`workshop`, `class_package`, `pt_package`), client_id (FK), booking_id (FK, nullable), client_package_id (FK, nullable), status enum (`pending`, `succeeded`, `refunded`, `failed`), receipt_url (text, nullable — Stripe-hosted receipt; populated by `payment_intent.succeeded` webhook handler from `latest_charge.receipt_url`), refunded_at (nullable), created_at.

**Indexes:** `(payment_intent_id) unique`, `(client_id, created_at desc)`.

The fe-client `/account/invoices` "Download" link points directly to `receipt_url`; no PDF generation needed.

### 4j. Content

#### `email_templates` (§17)

id, slug (text unique — e.g. `class_booking_confirmed`, 22 seeded values), subject (text), body_html (text), updated_at, updated_by_staff_id (FK).

**Slug list (22):**
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
referral_credited
```

#### `email_log`

id, template_slug (text), recipient_email (text), recipient_user_id (uuid, nullable), recipient_user_kind enum (`client`, `staff`), subject_rendered (text), body_rendered (text), status enum (`queued`, `sent`, `failed`), smtp_message_id (text, nullable — RFC 5322 `Message-ID` header returned by Nodemailer), smtp_response (text, nullable — last line of SMTP server response), error (text, nullable), queued_at, sent_at.

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

Lets us dark-launch deferred features (e.g. waitlist, promo codes) and toggle non-critical surfaces without redeploying.

| Column | Type | Notes |
|---|---|---|
| key | text | PK — e.g. `waitlist_enabled`, `promo_codes_enabled` |
| enabled | boolean | not null, default `false` |
| updated_at | timestamptz | not null, default now() |
| updated_by_staff_id | uuid | FK → staff_users.id |

**Read pattern:** `lib/feature-flags-cache.ts` loads all rows at boot into an in-memory map; admin toggle (`PATCH /api/v1/portal/admin/feature-flags/:key`) updates DB + invalidates cache (process-local — multi-instance deploys would need a pub/sub trigger, deferred).

**Subsumed tables (drop during reshape).** The existing `/be` scaffolding had `cancellation_requests` and `refund_requests` tables modelling an admin-approval workflow. These are not used in v1 — the spec's automated cancellation flow + `inbox_items` (for any actionable cases) cover the same surface area without introducing an admin-resolution queue. Drop both tables when reshaping the schema.

### 4l. Inbox (§13)

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

## 5. Background Jobs

**v1 strategy:** `node-cron` for non-critical periodic jobs (in-process, no Redis dependency). The durable BullMQ queue is added when the Stripe refund flow goes live, since refund retries need durability across process restarts. Until then, refund automation runs synchronously inside the cancel-workshop request handler with explicit error logging.

### `node-cron` schedulers (in-process)

| Job | Schedule | Handler |
|---|---|---|
| `email` send | Triggered (not scheduled) — invoked by any service via `services/notifications/send.ts:enqueueEmail()`, executed inline against the SMTP transport | Render template + variables → `lib/mailer.ts` (Nodemailer) → write `email_log`. In v1 this is synchronous (no queue); failures are logged and surfaced in `email_log.status='failed'` with `error` populated from the Nodemailer rejection |
| `checkin-nag` | Daily 03:00 SGT (`node-cron`) | Find sessions where `ends_at` between now-25h and now-23h AND any booking has `check_in_state='pending'` → send `checkin_nag` email to assigned instructor (cc admin), one per session |
| `credit-expiry` | Daily 03:00 SGT (`node-cron`) | Find `client_packages` where `expires_at` between now+6.5d and now+7.5d → send `credit_expiry_reminder` email |
| Workshop admin-cancel refunds | Triggered (not scheduled) by admin route | For each booking in workshop: call Stripe Refund API → on success, update booking `state='cancelled'`, `refund_outcome='stripe_refunded'`; emit one inbox item for the workshop. **v1: synchronous.** **Future: BullMQ with idempotency key = booking_id.** |

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

### 6a. Clerk

- **Two applications.** Separate publishable + secret keys, separate JWT issuers, separate user pools — enforces §15b "staff and client spaces are independent."
- **Middleware split.** `/api/v1/me/*` uses `clerk-client.ts`; `/api/v1/portal/*` uses `clerk-staff.ts`. Each verifies its own JWT issuer; cross-app tokens are rejected.
- **Identity glue.** Our DB stores `clerk_user_id` on `clients` and `staff_users`. Clerk owns auth state (password, sessions, MFA); we own profile + role + relationships.
- **`user.created` webhook** upserts the `clients` (or `staff_users`) row on first sign-in. For staff, it pairs with a pending `staff_invitations` row by email.
- **Profile edits** flow through Clerk (name, password). `user.updated` webhook syncs name/email back to our row.
- **Force-logout on archive** (§15c) — admin-archive route calls Clerk's `revokeAllSessions(userId)` API.
- **Staff invitations.** We own the `staff_invitations` row (token, role, audit). Clerk's invitation API handles email + accept-link UX. On accept, the webhook fires and we link `clerk_user_id` to the matching `staff_users.id`.
- **Pre-booking verification gate.** `fe-client-features.md` requires `phone_verified` AND `email_verified` before any booking action. Read these directly from the Clerk session token claims on the request — no `clients` columns. The `/me/bookings/*` route handlers reject with `403 verification_required` when either claim is false; fe-client surfaces the appropriate verify CTA.

### 6b. Stripe

- **Payment Intents only** in v1 (no Checkout Sessions, no Subscriptions). Backend creates intent → returns `client_secret` → fe confirms with Stripe.js.
- **`payment_intent.succeeded` webhook** → `billing/grants.ts`:
  - kind=`class_package` or `pt_package` → insert `client_packages` row
  - kind=`workshop` → insert `bookings` row (workshop_id + workshop_tier_id + state=`confirmed`)
  - Always insert `stripe_payments` row with `status='succeeded'`
- **Workshop admin-cancel** (§7a) → enqueue one `stripe-refund` job per booking in workshop. Worker calls Stripe Refund API. `charge.refunded` webhook closes the loop.
- **Free workshops** (`workshop_tiers.regular_price_sgd = 0`) skip Stripe entirely. Booking flow inserts a `bookings` row with `kind='workshop'`, `state='confirmed'`, `stripe_payment_intent_id = null`, and **no** `stripe_payments` row is created. The receipt UI on fe-client suppresses the Download link when `receipt_url` is null.
- **Idempotency.** Stripe's event IDs are deduplicated against `stripe_payments.payment_intent_id` (and a separate `stripe_webhook_events` table for raw event de-dupe — minor, can add later).

### 6c. Cloudflare R2

- S3-compatible. `@aws-sdk/client-s3` with R2 endpoint and credentials.
- **Buckets:** `yoga-sadhana-public` (workshop covers, instructor photos — served via R2 public URL); `yoga-sadhana-private` (reserved, unused in v1).
- **Upload flow:** backend issues presigned PUT URL with content-type and 5 MB cap → fe uploads directly → fe POSTs the returned key back to backend, backend stores in `instructors.photo_r2_key` / `workshops.cover_r2_key` / `workshop_images.r2_key`.

### 6d. SMTP (Nodemailer)

- **Transport.** `lib/mailer.ts` constructs a single Nodemailer SMTP transport at boot from env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` (boolean — true for 465, false for 587 STARTTLS), `SMTP_FROM` (RFC 5322 from address, e.g. `Yoga Sadhana <hello@yogasadhana.sg>`). The same transport is reused across all sends.
- **Provider-agnostic.** Any SMTP provider works (AWS SES SMTP endpoint, Gmail relay, Mailgun SMTP, Sendgrid SMTP, self-hosted Postfix). Switching providers is an env var change, no code change.
- **Server-side rendering** via `services/notifications/render.ts`:
  - Parse template body for `{{variable}}` tokens
  - Validate against `services/notifications/variables.ts` allow-list per slug (this is what powers the §17c amber flag in fe — same source of truth)
  - Substitute values; sanitise (XSS safe — rich text from admin trusted, but variables themselves escaped)
- **Logging.** One `email_log` row per recipient per send. On send success, store Nodemailer's `info.messageId` in `smtp_message_id` and the last line of `info.response` in `smtp_response`. On rejection, store the error in `error` and set `status='failed'`.
- **No bounce webhook.** SMTP itself has no callback channel for asynchronous bounces (bounces arrive as DSN emails to the configured `Return-Path`). v1 does not parse DSNs. If the chosen provider exposes its own bounce API (e.g. AWS SES `SendingNotifications` SNS topic), add it as a separate webhook later — out of scope for v1.
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

### Audit middleware

Mounted on `/api/v1/portal/*` with method in `(POST, PUT, PATCH, DELETE)`. Captures `(actor_staff_id, action_inferred_from_route, target_table, target_id, payload)` and inserts into `audit_log` after the route handler succeeds. Services can also write directly for cron / webhook events (`actor_type='system'`).

### Event state (§11)

`services/policy/event-state.ts` — pure function over `(starts_at, ends_at, lifecycle, now)`. Called by every read endpoint that returns schedule entities. The fe never persists this; backend never stores this.

### Per-booking codes (§11)

On booking creation, `services/bookings/qr.ts:generateBookingCodes()` returns:
- `qr_token` — 32-byte URL-safe random; encoded into QR, not human-readable.
- `code` — `YS-` + **6 Crockford base32** characters (alphabet: `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, omitting `I`, `L`, `O`, `U` to prevent visual ambiguity). Uniqueness enforced via DB unique index. Stored uppercase; lookup uppercases input and treats `0`↔`O` and `1`↔`I/L` as the same char (defensive against manual entry typos).

Example: `YS-A4F2K9`. Collision probability over 10⁶ bookings on a 32⁶ ≈ 10⁹ space is ~5e-4; uniqueness retry loop handles the rare collision.

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
2. Pick the referrer's most recent active `client_packages` row (`kind in ('credit_bundle','unlimited')`, `expires_at > now()`). If none exists, insert a 90-day "referral credit" `client_packages` row with `kind='credit_bundle'`, `credits = 20 / standard_credit_value_sgd`, `amount_paid_sgd = 0`, `stripe_payment_intent_id = NULL`.
3. Insert `manual_adjustments` row: `client_id = referrer`, `client_package_id = chosen`, `delta = credits granted`, `reason = 'referral_conversion'`, `acted_by_staff_id = NULL`.
4. Update referee: `UPDATE clients SET referral_credit_granted_at = now() WHERE id = referee`.
5. Write `audit_log` row: `actor_type='system'`, `action='referral.converted'`, target = referrer's `clients.id`.
6. Send referrer an email (template slug `referral_credited` — add to the seeded list in §17b alongside the existing 21).

**Idempotency:** the `referral_credit_granted_at` UPDATE in step 4 is inside the webhook transaction. On retry, step 1 short-circuits because the column is now non-null. No double-grant possible.

The "first paid" gate is implicit: the referee's first successful Stripe payment is the only event that runs this code, since steps 1–6 are guarded by `referral_credit_granted_at IS NULL`.

### Migrations

`drizzle-kit generate` → SQL committed to `db/migrations/` → `drizzle-kit migrate` on deploy. Schema-additive only by default. Destructive changes (drops, type narrowing) require explicit data-migration scripts checked in alongside.

### Seed (`db/seed/`)

Run idempotently on fresh deployment:
- **superadmin.ts** — reads `SUPERADMIN_EMAIL` env, creates `staff_users` row with role=`superadmin`, status=`pending` (real activation via Clerk first-login)
- **email-templates.ts** — inserts the 22 templates with default subject + body
- **waiver.ts** — inserts the singleton waiver row with placeholder body
- **policy.ts** — inserts singleton `global_policy` and `pt_booking_config` with sensible defaults

---

## 8. Phase Boundaries

**This phase (in scope):**
- All schema in §4 (including amendments: `clients.gender`/`dob`, `marketing_content`, `stripe_payments.receipt_url`, `feature_flags`).
- All routes in §2: `routes/portal/admin/*`, `routes/portal/instructor/*` (read-only views), `routes/client/*`, `routes/public/*`, `routes/webhooks/*`.
- All cron handlers in §5 (run via `node-cron`).
- Referral chain populated AND reward-grant logic wired (see §7 Referral conversion crediting). Was previously deferred; now in scope because it reuses existing primitives.
- `audit_log` table populated; admin-facing read views deferred.

**Next phase (per `admin-restructure.md` §19):**
- Reports module — read-only aggregate queries over existing tables.
- Audit log surfacing UI — table populated this phase; read endpoints + admin views deferred.
- Instructor self-service availability — admin sets availability for instructors in v1 (`routes/portal/instructor/availability.ts` is read-only this phase).
- Dashboard — read-only metric aggregates.
- BullMQ + Redis for durable Stripe refund retries — `node-cron` handles non-critical jobs in v1; the refund queue lands when refund automation is fully wired.

**Out of scope for v1 (gated by `feature_flags` if needed):**
- **Promo codes at checkout.** The fe-client checkout mockup includes a promo input (`SADHANA20`, `FRIEND10`); `fe-client-features.md` does not specify them. Treat the input as non-functional in v1. If kept later: add `promo_codes (code unique, kind=fixed_sgd|percent, amount, valid_from, valid_to, max_uses, used_count, status)` and a `promo_redemptions` ledger.
- **Class waitlist.** `fe-client-features.md` §Booking Rules mentions "Full → Join Waitlist" with seat-available email + time-bound claim CTA. v1 UI shows "Full" with no waitlist CTA. If kept later: add `waitlist_entries (client_id, class_id|workshop_tier_id, joined_at, offered_at, offer_expires_at, status=waiting|offered|claimed|expired|cancelled)`.
- **WhatsApp / SMS / push notifications.** Email-only in v1.
- **Multi-tenant SaaS surface.** This backend serves Yoga Sadhana exclusively; no tenant scoping.

---

## 9. Open Questions

1. **Postgres host** — Neon (branching), Supabase Postgres, RDS, or self-hosted?
2. **Redis host for BullMQ** — Upstash (serverless-friendly) or self-hosted?
3. **Deployment target** — Fly.io / Railway / Render are good fits for both HTTP + worker. Vercel is HTTP-only (no long-lived worker).
4. **Email rendering** — React Email (rich JSX templates) or plain HTML with `{{var}}` substitution? React Email is nicer DX but adds a build step.
5. **Stripe webhook event de-dupe** — add `stripe_webhook_events` table now, or rely on `stripe_payments.payment_intent_id` uniqueness?
