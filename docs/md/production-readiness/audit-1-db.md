# Audit 1 — Database layer

Scope: `be/src/db/*`, `be/src/env.ts`, `be/src/server.ts`, every schema file (via the latest Drizzle snapshot `be/src/db/migrations/meta/0141_snapshot.json`, which CI's drift job keeps equal to `src/db/schema/`), the migrations, and the service code that decides how long a connection is held. Read-only; nothing was run against a database, so anything that needs `EXPLAIN` or row counts is marked SUSPECTED.

Paths are relative to `be/` unless they start with `.github/` or `docs/`.

---

## (a) How the slice works

**One pool, default-sized.** `src/db/index.ts:27` is `postgres(url)` with no options, on `DATABASE_APP_URL` (role `booking_app`, non-owner, so RLS applies). postgres.js 3.4.9 defaults therefore apply: `max: 10`, `idle_timeout: 0` (never), `connect_timeout: 30s`, `max_lifetime` random 30-60 min, `prepare: true`, no `statement_timeout`, no `lock_timeout`, no `idle_in_transaction_session_timeout`, no queue/acquire timeout. This is the only runtime pool: Better Auth's three pools are *table sets*, not connection pools — both `drizzleAdapter(db, …)` calls (`src/services/auth/better-auth.ts:234,319`) take the same `db` proxy. Cron jobs use it too. The owner role is only used by `migrate.ts:9`, `seed/run.ts:43`, `e2e/cli.ts:42`, each `max: 1`.

**One transaction per studio request.** `middleware/tenant.ts:102` runs the rest of the request inside `withTenant` (`db/index.ts:58-85`): `BEGIN` → `select set_config('app.tenant_id', $1, true)` → handler → `COMMIT`. The exported `db` is a Proxy (`index.ts:147-157`) that resolves to that transaction through `AsyncLocalStorage`, and `db.transaction` inside a scope becomes a savepoint (`index.ts:231-244`). So every request, read or write, pins one of the 10 connections from tenant resolution until the handler returns. Slug resolution itself is a 60 s in-process memo (`services/tenants/tenants.ts:64-136`) and runs on the bare pool before the transaction.

**After-commit work.** `afterCommit()` queues work (almost always an email, 35 call sites) which `runAfterCommit` (`index.ts:120-130`) runs after the request's COMMIT, each piece in a *new* `withTenant` transaction, sequentially, awaited before `withTenant` returns — i.e. before the HTTP response is sent.

**Retry.** `retryingTransaction` (`index.ts:197-213`) re-runs a savepoint up to 4 times on `40P01`/`40001` (`retryable-abort.ts`), 7 named paths.

**RLS.** `ensureTenantIsolation` (`roles.ts:159-190`) runs after every `db:migrate`: for each table with a `tenant_id` column (except `tenant_settings`) it does `ENABLE`, `FORCE`, `DROP POLICY IF EXISTS`, `CREATE POLICY tenant_isolation USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)`. Cross-tenant lookups go through owner-owned `SECURITY DEFINER` functions (`routing.ts`, migrations 0034/0043/0057/0122…).

**Jobs.** `jobs/index.ts:56-83` loops tenants sequentially, one `withTenant` per tenant per job; 3 jobs fire on `*/5`, 5 more on the 15-minute grid (`:167-175`).

**Hosting.** One Node process (`tsx src/server.ts`, `Dockerfile`) and one Postgres 16 container (`db-booking`) on a single VPS; the Postgres container's configuration lives in the infra repo, not here — nothing in this repo sets `max_connections` or any server timeout. Deploy runs `db:migrate && db:seed` in a one-off container **while the old server is still serving** (`.github/workflows/deploy-be.yml:771-780`, `src/db/migrations/README.md` rule 0).

---

## (b) Table → index inventory

89 tables. `U` = unique. Generated from `meta/0141_snapshot.json`. PK = primary key.

Mechanical checks over the inventory:
- **Every FK has an index with the FK column leading**, with two exceptions that are only covered by a partial index: `client_packages.client_id` (has `(tenant_id, client_id, …)` composites but the only `client_id`-leading index is the partial trial-unique) and `promo_code_redemptions.promo_code_id` (only the partial `(promo_code_id, client_id) WHERE status <> 'refunded'`).
- **No exact-prefix duplicates**, but see DB-17: ~45 single-column `*_fk_idx` indexes sit beside a `(tenant_id, <same col>, …)` composite.
- **Every tenant-scoped table has at least one index leading with `tenant_id`.**

```
attention_dismissals      PK(id) · (dismissed_by_staff_id) · U(tenant_id, kind, subject_id)
audit_log                 PK(id) · (actor_staff_id) · (tenant_id, target_table, target_id, created_at) · (tenant_id, actor_staff_id, created_at) · (tenant_id, action, created_at)      [payload jsonb]
audit_log_archive         PK(id) · (former_tenant_id, created_at)      [payload jsonb]
auth_events               PK(id) · (tenant_id, created_at) · (actor_user_id, created_at)
bookings (25 cols, 18 idx) PK(id) · FK singles: (applied_promo_code_id) (applied_promotion_id) (class_id) (client_id) (client_package_id) (pt_session_id) (purchase_id) (workshop_id) (workshop_tier_id)
                          · (tenant_id, client_id, booked_at) · (tenant_id, class_id, state) · (tenant_id, workshop_tier_id, state) · (tenant_id, pt_session_id)
                          · U(tenant_id, qr_token) · U(tenant_id, code) · (tenant_id, check_in_state)
                          · U(tenant_id, purchase_id) WHERE purchase_id IS NOT NULL · U(tenant_id, classpass_reservation_id) WHERE … IS NOT NULL
cancellations             PK(id) · (booking_id) · (client_id) · (cancelled_by_staff_id) · (tenant_id, client_id, cancelled_at)
check_ins                 PK(id) · (checked_in_by_staff_id) · (tenant_id) · U(booking_id)
class_packages            PK(id) · (tenant_id, status, kind) · (tenant_id, deleted_at)
class_rule_packages       PK(class_id, class_package_id) · (class_package_id) · (tenant_id, class_package_id)
class_series              PK(id) · (class_type_id) (created_by_staff_id) (location_id) (main_instructor_id) (room_id) · (tenant_id, class_type_id)
class_series_rule_packages PK(series_id, class_package_id) · (class_package_id) · (tenant_id, class_package_id)
class_series_supporting_instructors PK(series_id, instructor_id) · (instructor_id) · (tenant_id, instructor_id)
class_supporting_instructors PK(class_id, instructor_id) · (instructor_id) · (tenant_id, instructor_id)
class_types               PK(id) · (parent_id) · (tenant_id, archived_at) · (tenant_id, deleted_at) · (tenant_id, lower(name)) · (tenant_id, parent_id)
classes (22 cols, 15 idx) PK(id) · FK singles: (cancelled_by_staff_id) (class_type_id) (created_by_staff_id) (location_id) (main_instructor_id) (room_id) (series_id)
                          · (tenant_id, starts_at) · (tenant_id, series_id, starts_at) · (tenant_id, main_instructor_id, starts_at) · (tenant_id, location_id, starts_at)
                          · (tenant_id, room_id, starts_at) · (tenant_id, class_type_id) · (tenant_id, lifecycle, starts_at)
classpass_inbound_emails  PK(id) · U(tenant_id, message_id) · (tenant_id, received_at) · (tenant_id, review_reason) WHERE review_reason IS NOT NULL · (client_id) (booking_id) (resolved_by_staff_id)   [authentication jsonb, headers jsonb, text, html]
classpass_location_mappings PK(id) · U(tenant_id, location_name) · (location_id)
classpass_settings        PK(id) · U(tenant_id) · U(address_token)
client_auth_accounts      PK(id) · (user_id) · (tenant_id)
client_auth_sessions      PK(id) · U(token) · (user_id) · (tenant_id) · (claimed_tenant_id)
client_auth_users         PK(id) · U(tenant_id, email)
client_auth_verifications PK(id) · (identifier) · (tenant_id)
client_billing_details    PK(id) · (client_id) · (tenant_id, client_id, created_at) · U(tenant_id, client_id) WHERE is_default
client_packages (22 cols) PK(id) · FK singles: (applied_promo_code_id) (applied_promotion_id) (bound_instructor_id) (location_id) (purchase_id) (source_class_package_id) (source_pt_package_id)
                          · (tenant_id, client_id, kind) · (tenant_id, client_id, expires_at) · U(tenant_id, purchase_id) WHERE purchase_id IS NOT NULL · U(client_id) WHERE kind = 'trial'
clients                   PK(id) · U(tenant_id, auth_user_id) · U(tenant_id, email) · (referred_by_client_id) · (tenant_id, status) · (tenant_id, referred_by_client_id) · (tenant_id, lower(name)) · (tenant_id, deleted_at)
corporate_packages        PK(id) · (created_by_staff_id) · (tenant_id, status) · (tenant_id, deleted_at)
corporate_requests        PK(id) · (client_id) (corporate_package_id) (purchase_id) (resolved_by_staff_id) · U(tenant_id, purchase_id) WHERE … · (tenant_id, status, created_at) · (tenant_id, client_id, status)
corporate_session_supporting_instructors PK(corporate_session_id, instructor_id) · (instructor_id) · (tenant_id, instructor_id)
corporate_sessions        PK(id) · 6 FK singles · (tenant_id, starts_at) · (tenant_id, main_instructor_id, starts_at) · (tenant_id, location_id, starts_at) · (tenant_id, room_id, starts_at) · (tenant_id, lifecycle, starts_at)
credit_movements          PK(id) · (client_id) (client_package_id) (booking_id) (acted_by_staff_id) · (tenant_id, client_package_id, created_at)
email_log (15 cols)       PK(id) · (tenant_id, recipient_user_id, queued_at) · (tenant_id, status) · (tenant_id, template_slug, queued_at)      [subject_rendered, body_rendered text NOT NULL]
email_switches            PK(id) · U(tenant_id, slug)
email_templates           PK(id) · (updated_by_staff_id) · U(tenant_id, slug)
feature_flags             PK(tenant_id, key) · (updated_by_staff_id)
former_slugs              PK(slug) · (renamed_tenant_id)
global_policy             PK(id) · (updated_by_staff_id) · U(tenant_id)
instructor_class_types    PK(instructor_id, class_type_id) · (class_type_id) · (tenant_id)
instructors               PK(staff_user_id) · (tenant_id)
leave_conflicts           PK(instructor_a_id, instructor_b_id) · (instructor_b_id) · (tenant_id)
leave_pools               PK(staff_user_id, type, leave_year) · (tenant_id)
leave_requests            PK(id) · (decided_by_staff_id) (staff_user_id) · (tenant_id, staff_user_id, leave_year) · (tenant_id, start_date, end_date) · (tenant_id, status)
locations                 PK(id) · (tenant_id, archived_at) · (tenant_id, deleted_at)
manual_adjustments        PK(id) · (acted_by_staff_id) (client_id) (client_package_id) · (tenant_id, client_id, created_at) · (tenant_id, client_package_id)
manual_payroll_entries    PK(id) · (created_by_staff_id) (instructor_id) · (tenant_id, instructor_id, entry_date)
marketing_content         PK(id) · (updated_by_staff_id) · U(tenant_id)      [testimonials jsonb]
merch                     PK(id) · (tenant_id, archived_at)
merch_orders              PK(id) · (client_id) (merch_id) · (tenant_id, client_id, created_at) · U(tenant_id, stripe_payment_intent_id)
payment_customers         PK(id) · (client_id) · U(tenant_id, client_id, provider_account_id)
platform_auth_accounts    PK(id) · (user_id)
platform_auth_sessions    PK(id) · U(token) · (user_id)
platform_auth_two_factors PK(id) · (user_id) · (secret)
platform_auth_users       PK(id) · U(email)
platform_auth_verifications PK(id) · (identifier)
platform_settings         PK(id)
promo_code_products       PK(promo_code_id, product_type, product_id) · (tenant_id)
promo_code_redemptions    PK(id) · (client_id) · (tenant_id) · U(promo_code_id, client_id) WHERE status <> 'refunded'
promo_codes               PK(id) · (created_by_staff_id) · U(tenant_id, code)
promotions                PK(id) · (created_by_staff_id) · (tenant_id, parent_type, parent_id, status, starts_at, ends_at) · (tenant_id, sort_id)
pt_booking_config         PK(id) · (updated_by_staff_id) · U(tenant_id)
pt_packages               PK(id) · (tenant_id)
pt_request_slots          PK(id) · (pt_request_id) · (tenant_id, pt_request_id)
pt_requests (23 cols)     PK(id) · 8 FK singles · (tenant_id, status, created_at) · (tenant_id, client_id, status) · (tenant_id, location_id, status) · (tenant_id, class_type_id) · (tenant_id, expires_at) WHERE status = 'pending'
pt_session_clients        PK(pt_session_id, client_id) · (client_id) · (tenant_id)
pt_session_supporting_instructors PK(pt_session_id, instructor_id) · (instructor_id) · (tenant_id)
pt_sessions               PK(id) · 5 FK singles · (tenant_id, instructor_id, starts_at) · (tenant_id, lifecycle, starts_at) · (tenant_id, room_id, starts_at) · U(pt_request_id)
purchases (18 cols)       PK(id) · (client_id) · (tenant_id, client_id, created_at) · (tenant_id, status) · U(tenant_id, checkout_session_id)      [metadata, lines, bill_to jsonb]
receipt_counters          PK(tenant_id)
receipts (23 cols)        PK(id) · (purchase_id) (client_id) · U(tenant_id, purchase_id) · U(tenant_id, number) · U(tenant_id, display_number) · (tenant_id, client_id, issued_at)      [bill_to, lines, payments jsonb]
rooms                     PK(id) · (tenant_id, location_id, archived_at) · (tenant_id, deleted_at) · U(location_id, lower(name))
staff_auth_accounts       PK(id) · (user_id) · (tenant_id)
staff_auth_sessions       PK(id) · U(token) · (user_id) · (tenant_id) · (claimed_tenant_id)
staff_auth_two_factors    PK(id) · (user_id) · (secret) · (tenant_id)
staff_auth_users          PK(id) · U(tenant_id, email)
staff_auth_verifications  PK(id) · (identifier) · (tenant_id)
staff_invitations         PK(id) · (invited_by_staff_id) (staff_user_id) · (tenant_id, email, status) · (tenant_id, invited_by_staff_id) · U(tenant_id, token)
staff_updates             PK(id) · (recipient_staff_id) (subject_client_id) · (tenant_id, recipient_staff_id, read_at, created_at)      [payload jsonb]
staff_users (25 cols)     PK(id) · U(tenant_id, auth_user_id) · U(tenant_id, email) · (archived_by_staff_id) · (tenant_id, role, status) · (tenant_id, deleted_at)
stripe_payments (19 cols) PK(id) · (booking_id) (client_id) (client_package_id) (purchase_id) · U(tenant_id, payment_intent_id) · (tenant_id, client_id, created_at) · (tenant_id, purchase_id)
tenant_imports            PK(id) · U(tenant_id) WHERE status IN ('uploading','processing') · (tenant_id, created_at)      [summary jsonb]
tenant_payment_credentials PK(tenant_id)
tenant_settings           PK(tenant_id)      [copy, theme jsonb]
tenants                   PK(id) · U(slug) · (status)
waitlist_entries          PK(id) · (booking_id) (class_id) (client_id) · (tenant_id, class_id, status, joined_at) · (tenant_id, client_id, status) · U(tenant_id, class_id, client_id) WHERE status = 'waiting'
workshop_days             PK(id) · (room_id) · U(workshop_id, ord) · (tenant_id, starts_at) · (tenant_id, room_id, starts_at)
workshop_images           PK(id) · (workshop_id) · (tenant_id, workshop_id, ord)
workshop_instructors      PK(workshop_id, instructor_id) · (instructor_id) · U(workshop_id) WHERE role = 'main' · (tenant_id, workshop_id, role)
workshop_tier_days        PK(workshop_tier_id, workshop_day_id) · (workshop_day_id) · (tenant_id, workshop_day_id)
workshop_tiers            PK(id) · (workshop_id) · (tenant_id, workshop_id, ord)
workshops                 PK(id) · (cancelled_by_staff_id) (created_by_staff_id) (location_id) · (tenant_id, location_id, lifecycle) · (tenant_id, lifecycle)
```

Column types are sound: all 173 timestamps are `timestamp with time zone`, money is `numeric(10,2)` (31 columns), domain ids are `uuid`, Better Auth ids are `text` as that library requires. `client_packages` has `CHECK (credits_or_sessions_remaining >= 0)`; `classes` / `workshop_days` / `pt_sessions` have capacity and `ends_at > starts_at` checks.

---

## (c) Findings

Severity: P0 will break/corrupt at the target load · P1 real cost or risk at the target load · P2 waste / best practice · P3 nit.

### DB-01 — P0 — CONFIRMED — The whole platform runs on 10 connections, and every request holds one for its full life
- **Evidence.** `src/db/index.ts:27` `const client = postgres(url)` — no `max`, so postgres.js's default of 10. `src/middleware/tenant.ts:102` `await withTenant(resolved.tenant.id, () => next())` puts every `/api/v1/*` studio request (reads included) inside one transaction, so a connection is pinned from tenant resolution to handler return. The file says so itself: `index.ts:51-53` "a request holds a pooled connection for its whole life, including any Stripe or mail call inside it". postgres.js has no acquire timeout: an 11th concurrent request simply waits, with no error and no log.
- **At 100 members + 10 admins.** Concurrency ceiling is 10 in-flight requests across all tenants, auth, cron jobs and webhooks combined. Pure-DB requests (tens of ms) fit comfortably; the ceiling is hit as soon as a handful of requests are slow (DB-02, DB-03, DB-04, DB-05). When it is hit, every studio stalls together — one studio's burst is every studio's outage — and `/health` (`src/app.ts:182-189`, `db.execute(sql\`SELECT 1\`)` on the same pool) hangs with them, so the container looks dead.
- **Fix.** Configure the pool explicitly in `db/index.ts`: `max` ~30 (Postgres default `max_connections` is 100; staging and production each have their own Postgres container, plus 1 owner connection for migrate/seed/backup — confirm `max_connections` in the infra repo and document the budget), `idle_timeout: 30`, `connect_timeout: 10`, `connection: { application_name: 'booking-be', statement_timeout: 15000, lock_timeout: 5000, idle_in_transaction_session_timeout: 30000 }`. Expose `DB_POOL_MAX` as an env var (deploy-be.yml + .env.example + env.ts). Add an acquire deadline (wrap `pool.transaction` in a timer that answers 503 `db_busy` rather than hanging) and log pool saturation. Raising `max` is necessary but not sufficient — DB-02/03/04 are what actually drain it.

### DB-02 — P0 — CONFIRMED — After-commit mail holds a pooled connection, idle in a transaction, for the whole Resend call (and its pacing and retries), and the HTTP response waits on it
- **Evidence.** `index.ts:120-130` `runAfterCommit` wraps each piece of work in a fresh `withTenant(tenantId, async () => { await run() })`, and `withTenant` awaits it at `index.ts:83` before returning. The work is an email: e.g. `services/bookings/book.ts:185` `afterCommit(() => sendClassBookingEmail(...))`. `services/notifications/send.ts:221-290` (`deliver`) inserts the `email_log` row, then `await sendMail(...)`, then updates the row — all inside that transaction. `lib/send-gate.ts:42-50` paces at 8 sends/s, retries up to 5 attempts with backoff capped at 30 s; the Resend call itself has a 5 s deadline (`lib/outbound.ts:36-41`).
- **At target load.** Every class booking, cancellation, purchase, PT request etc. costs two transactions, the second idle-in-transaction across a third-party HTTP call (normally 200-500 ms). Ten members booking in the same half-second (a class release) saturate the pool on mail alone. When Resend is slow or rate-limiting, each of those connections is held for up to minutes (5 attempts × (5 s + up to 30 s backoff)); the pool is gone and every studio is down until Resend recovers. A bulk send from one admin action (`cancel-class.ts:241` mails every booked member inside one after-commit piece) holds a connection for N sends. Also: the `queued` `email_log` row is uncommitted while the send is in flight, so a crash mid-send loses the log row for a message that may have been delivered, and the open xid holds back vacuum.
- **Fix.** Make mail a real outbox: write the `email_log` row as `queued` inside the business transaction (or a short one), commit, and send from an in-process worker that holds no connection during the HTTP call and opens a short transaction only to record the outcome. The response should not await delivery. Until then, at minimum split `deliver` into three short transactions (insert / send with no connection / update).

### DB-03 — P1 — CONFIRMED — Stripe, R2 and logo fetches run inside the request transaction
- **Evidence.** Because the request is one transaction (DB-01), any vendor call made from a route or service holds a connection and whatever row locks the request has taken. Call sites through `outbound(...)`: `services/billing/checkout-session.ts`, `payment-customers.ts` (6), `payment-methods.ts:58`, `refunds.ts:791` (`stripe.refunds.create`), `packages/promo-redemption.ts` (2), `routes/client/purchases.ts`, `lib/r2.ts` (4: put/delete/sign), `services/receipts/logo.ts:48`. Deadlines are 8 s Stripe / 8 s storage / 3 s logo (`lib/outbound.ts:36-41`). The Stripe webhook does the same with retries on: `webhook-handler.ts:616` `withTenant(named, () => dispatchStripeEvent(..., retry))`, `OFF_REQUEST_RETRY` = 3 attempts (`outbound.ts:60`), so up to ~30 s per delivery.
- **At target load.** Each member checkout pins a connection for a Stripe round trip (300 ms-1 s normal, 8 s worst). Ten simultaneous checkouts during a Stripe slowdown exhaust the pool for 8 s. No `lock_timeout` means a request that locked a class or package row and then calls Stripe blocks every other booking on that row for the same time.
- **Fix.** Restructure vendor-calling routes as: short transaction (validate, create pending row) → commit → vendor call with no connection held → short transaction (record result). This needs an opt-out from the middleware's request-wide transaction for those routes (e.g. a `withTenant` per unit of work instead of per request). Cross-slice: the client/portal auditors own the per-route list.

### DB-04 — P1 — CONFIRMED — A handler that throws does not roll the request transaction back
- **Evidence.** Hono 4.13.7 `node_modules/hono/dist/compose.js`: each dispatch level wraps its handler in `try { res = await handler(context, () => dispatch(i + 1)) } catch (err) { … res = await onError(err, context) … }`. A throw in a route handler is therefore caught at that handler's level and turned into a response; the `next()` promise that `resolveTenant` awaits **resolves normally**. `middleware/tenant.ts:102` then lets `withTenant` return, which COMMITs (`index.ts:64-84`) and runs the after-commit work. The repo knows half of this — `middleware/error.ts:20-24`: "Hono catches a thrown error at the layer that threw it … so the `try` in `errorBoundary` below never sees one" — but nothing reads `c.error` (grep: no use in `src/`). The comment at `index.ts:81-82` ("A transaction that threw never reaches here, so its work is dropped with it") is not true for a request.
- **What survives.** A Postgres error aborts the transaction on its own, and a throw inside `db.transaction(...)` rolls its savepoint back — so the multi-step writes that are wrapped in a savepoint (booking, cancel, purchase) are atomic. What is **not** rolled back: any write made directly on `db` (or in an earlier, completed savepoint) before a later `throw` of an `AppError`/Zod error in the same request. The client gets a 4xx/5xx and the partial write is committed, with its emails sent.
- **At target load.** Not load-dependent; it is a latent partial-write bug on every route that writes and then validates/throws. Severity depends on how many routes do that — SUSPECTED per route, the mechanism is CONFIRMED.
- **Fix.** In `resolveTenant`, make the transaction's fate follow the response: `await withTenant(id, async () => { await next(); if (c.error) throw c.error })` and have the outer `errorBoundary`/`onError` produce the same response (the response is already set on `c.res`; rethrowing only needs to trigger the rollback, then be swallowed). Add a test: a route that inserts a row then throws `ConflictError` leaves no row. Decide deliberately whether a non-2xx *returned* (not thrown) response should also roll back.

### DB-05 — P1 — CONFIRMED — Up to eight cron jobs start on the same tick and each takes a pool connection
- **Evidence.** `jobs/index.ts:167-175`: three jobs on `*/5 * * * *` and five on `SLOT_CRON` (the 15-minute grid). Each is a sequential per-tenant loop of `withTenant` (`:62-80`), so each holds one connection for as long as its tenant step runs — and steps like `sendCheckInNags` / `sendLapsingAlerts` register after-commit mail (DB-02), holding the connection across Resend.
- **At target load.** On :00/:15/:30/:45 up to 8 of 10 connections belong to jobs, leaving 2 for 110 users for the length of the slowest step. Class start times cluster on exactly those minutes, which is when members check in and book.
- **Fix.** Run the jobs through one serial queue (one connection for all jobs), or stagger the schedules (`1-59/5`, `2/15`, …), and give jobs their own small pool (`max: 2`) so they can never starve requests. Cross-slice with the cron auditor.

### DB-06 — P1 — CONFIRMED — No statement, lock or idle-in-transaction timeout anywhere
- **Evidence.** `index.ts:27` passes no `connection` options; no migration or role setup issues `ALTER ROLE booking_app SET …` (`roles.ts:39-104` only grants); a repo-wide grep for `statement_timeout|lock_timeout|idle_in_transaction` finds only test files. `src/server.ts:19-21` sets the HTTP `requestTimeout` to 60 minutes for every route.
- **At target load.** One unbounded admin query (DB-12's tenant-wide finance scans, an export) or one request stuck behind a row lock holds a connection for as long as it likes; nothing ever cancels it; with DB-01 that is 10% of capacity per stuck request. A `SELECT … FOR UPDATE` on a class row waits forever behind a holder.
- **Fix.** `ALTER ROLE booking_app SET statement_timeout = '15s'; SET lock_timeout = '5s'; SET idle_in_transaction_session_timeout = '30s'` in `ensureAppRole` (so it survives role re-provisioning), with `SET LOCAL` overrides for the known long paths (studio export/import). Map `57014`/`55P03` to a 503 in the error handler. Scope the 60-minute HTTP timeout to the import upload route only.

### DB-07 — P1 — CONFIRMED — Workshop capacity is checked without a lock: two members can take the last place
- **Evidence.** `services/workshops/book.ts:96-97`: "Capacity = per-day `capacity_online` vs confirmed bookings … Best-effort (no row lock) — acceptable for v1 volumes." `assertWorkshopBookable` (`:99-134`) reads counts with plain `SELECT`s. The free path takes only the member's own advisory lock (`:353` `lockMemberTime(tx, tenantId, [args.clientId])`), which serialises one member against themself, not two members against each other. The paid path checks before Stripe Checkout and inserts the booking from the webhook, minutes later. No database constraint backs it (inventory: nothing on `bookings` limits rows per `workshop_tier_id`).
- **At target load.** With 100 concurrent members, a popular workshop going on sale is exactly the race: N members pass the check for the last place, all pay, all get a confirmed booking. The file notes "no automated refund flow exists yet" (`:91-92`), so each oversell is a manual refund.
- **Fix.** Lock the workshop's day rows (`SELECT … FROM workshop_days WHERE id IN (…) ORDER BY id FOR UPDATE`) at the start of the insert transaction and re-count under the lock, in both the free path and the webhook's insert; on a paid loser, refund automatically or hold a place at checkout creation (a `pending` booking with an expiry).

### DB-08 — P1 — CONFIRMED — `ensureTenantIsolation` rewrites every policy on every deploy, under ACCESS EXCLUSIVE locks, non-atomically, against a live server
- **Evidence.** `roles.ts:170-187`: for each of ~75 tenant-scoped tables, four separate autocommit statements — `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, `… FORCE …`, `DROP POLICY IF EXISTS tenant_isolation`, `CREATE POLICY tenant_isolation` — about 300 DDL statements per deploy. `migrate.ts:9,28` runs it on a `max: 1` client with no transaction and no `lock_timeout`. The old container is still serving (`deploy-be.yml:771-780`).
- **What happens.** (1) Between `DROP POLICY` and `CREATE POLICY` the table has RLS forced and no policy, which is default-deny: a live request reading that table in that window gets zero rows and an insert fails — a silent wrong answer, e.g. "no bookings" or a class that looks empty and so accepts an overbooking. (2) Each statement needs ACCESS EXCLUSIVE; it queues behind any open request transaction that touched the table (seconds to minutes with DB-02/03), and every new query on that table queues behind *it*, so one slow request stalls the table for all tenants mid-deploy. (3) It grows linearly with tables.
- **Fix.** Make it a diff, not a rewrite: read `pg_class.relrowsecurity/relforcerowsecurity` and `pg_policies` once, and touch only tables that are missing RLS or whose policy text differs. Where a change is needed, do the four statements in one transaction with `SET LOCAL lock_timeout = '3s'` and retry. Keep the existing `rls-coverage` test as the guard.

### DB-09 — P2 — CONFIRMED — `email_log_sent_today()` is a cross-tenant sequential scan run after every email, with no index to serve it
- **Evidence.** `migrations/0057_email_log_sent_today.sql:24-34`: `SELECT count(*) FROM email_log WHERE sent_at >= date_trunc('day', …)`. No index has `sent_at` (inventory: `email_log` has three indexes, all `tenant_id`-leading on `queued_at`/`status`). Called from `lib/send-gate.ts:269` inside `checkHeadroom`, which runs after every delivery (`:~284`), via `lib/mailer.ts:144-154`.
- **At target load.** `email_log` never shrinks (DB-13) and each row carries the full rendered HTML. Every send scans the whole table's heap, while holding the DB-02 connection. Cost grows with the platform's lifetime mail volume.
- **Fix.** `CREATE INDEX email_log_sent_at_idx ON email_log (sent_at) WHERE sent_at IS NOT NULL`, and call the count at most once a minute (memoise in the gate). The 100/day constant (`send-gate.ts:44`) is Resend Free's cap — confirm the production plan; on a paid plan the check can go.

### DB-10 — P2 — CONFIRMED — Resend delivery webhooks look up `email_log` by `smtp_message_id`, which is not indexed
- **Evidence.** `services/notifications/delivery-outcomes.ts:140-157`: `UPDATE email_log … WHERE tenant_id = ? AND smtp_message_id = ? AND status IN (…)`, then a fallback `SELECT` on the same predicate. Inventory: no index contains `smtp_message_id`. The planner can use `(tenant_id, status)` and filter, i.e. it reads every row of that tenant in the earlier statuses.
- **At target load.** Several webhook events per email sent (sent/delivered/bounced…), each a per-tenant scan that grows forever.
- **Fix.** `CREATE UNIQUE INDEX email_log_message_idx ON email_log (tenant_id, smtp_message_id) WHERE smtp_message_id IS NOT NULL` (or non-unique if a message id can repeat).

### DB-11 — P2 — CONFIRMED — Refund-webhook routing scans `stripe_payments` across all tenants
- **Evidence.** `migrations/0043_payment_intent_routing_ambiguity.sql:21-30`: `SELECT DISTINCT tenant_id FROM stripe_payments WHERE payment_intent_id = $1`, SECURITY DEFINER (so no tenant predicate). The only index on the column is `U(tenant_id, payment_intent_id)` (`stripe_payments_intent_unique`) — `payment_intent_id` is the second column, so it cannot be used for a lookup without `tenant_id`. Callers: `db/routing.ts:21-48` from `refunds.ts:1192`, `webhook-handler.ts:465,1077`.
- **At target load.** Full scan of the platform's payment table on each `charge.refunded` and late-payment check. Low frequency today; grows with every payment ever taken.
- **Fix.** `CREATE INDEX stripe_payments_intent_idx ON stripe_payments (payment_intent_id)`.

### DB-12 — P2 — CONFIRMED (missing) / SUSPECTED (impact) — Admin finance and receipt lists filter a whole tenant by date with no `(tenant_id, <date>)` index
- **Evidence.** `services/finance/list.ts:162` (`client_packages.purchased_at`), `:191` (`bookings.booked_at`), `:221` (`stripe_payments.created_at`), `:246` (`merch_orders.created_at`); `services/receipts/read.ts:118-119,141,183` (`receipts.issued_at` range + `ORDER BY issued_at DESC, number DESC`). Each table's only date index is `(tenant_id, client_id, <date>)`, which cannot serve a tenant-wide range or sort.
- **At target load.** Each finance/receipts page load by an admin reads and sorts every row the studio has ever had in four tables. Fine at launch size; this is the query set that grows into the pool's slowest requests (and has no `statement_timeout`, DB-06).
- **Fix.** Add `bookings (tenant_id, booked_at)`, `client_packages (tenant_id, purchased_at)`, `stripe_payments (tenant_id, created_at)`, `receipts (tenant_id, issued_at DESC, number DESC)`, `merch_orders (tenant_id, created_at)`. Confirm with `EXPLAIN` as `booking_app`.

### DB-13 — P2 — CONFIRMED — Append-only tables with no retention
- **Evidence.** A grep for `.delete(` on the log-like tables finds only `staff_updates` (`services/attention/updates.ts:368`, pruned by the `pruneStaffUpdates` job) and one-off verification cleanup in `staff-email-change.ts`. Nothing ever deletes from:
  - `email_log` — one row per email with the full `subject_rendered` + `body_rendered` HTML (`send.ts:231-245`), including `skipped` rows (`send.ts:207-218`).
  - `auth_events` — one row per sign-in/auth event, with `ip` and `user_agent`.
  - `audit_log` (jsonb `payload`) and `audit_log_archive`.
  - `classpass_inbound_emails` — the raw `text`, `html`, `headers` and `authentication` of every forwarded email.
  - `client_auth_sessions` / `staff_auth_sessions` / `platform_auth_sessions` — no job removes expired rows and there is no index on `expires_at`. (SUSPECTED: Better Auth may clear some on sign-in; no code in this repo does.)
  - `client_auth_verifications` / `platform_auth_verifications` (SUSPECTED, same caveat).
- **At target load.** Not a day-one problem; it is what makes DB-09/10 and backups (the pre-deploy snapshot, "seconds at today's size", `deploy-be.yml:750-754`) degrade month over month, and it retains personal data (IP, raw mail) indefinitely.
- **Fix.** A daily platform job with a written retention table: e.g. null `email_log.body_rendered` after 90 days and delete after 13 months; delete expired sessions and verifications after 7 days; `auth_events` 13 months; ClassPass raw bodies 90 days after `resolved_at`. Add `(expires_at)` indexes on the three session tables for the sweep. `audit_log` is likely keep-forever — say so explicitly.

### DB-14 — P2 — CONFIRMED — The RLS policy calls `current_setting()` bare, not as an initplan
- **Evidence.** `roles.ts:180-184`: `USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)`. `current_setting` is STABLE, so Postgres can use the expression as an index condition (good — the `tenant_id`-leading indexes work), but wherever the policy is applied as a *filter* (sequential scans, joins driven by another index, the per-row `WITH CHECK` on bulk inserts) the three-function expression is re-evaluated for every row.
- **At target load.** A constant-factor CPU tax on every scan that is not driven by a `tenant_id` index. SUSPECTED magnitude — needs `EXPLAIN (ANALYZE)` as `booking_app`.
- **Fix.** `USING (tenant_id = (select nullif(current_setting('app.tenant_id', true), '')::uuid))` — the sub-select becomes a one-time InitPlan. Same for `WITH CHECK`. `ensureTenantIsolation` already owns the canonical text, so it is a one-line change (land it with DB-08's diffing so it applies once).

### DB-15 — P2 — SUSPECTED — RLS prevents non-leakproof predicates from being used as index conditions
- **Evidence.** Under RLS the policy qual is a security-barrier qual; a user predicate whose operator/function is not `LEAKPROOF` cannot be pushed into an index condition ahead of it. `lower()` and `LIKE/ILIKE` are not leakproof. So `clients_name_lower_idx (tenant_id, lower(name))` and `class_types_name_lower_idx` can be used by `booking_app` only for their `tenant_id` prefix; the `lower(name) = ?` part is applied as a filter. Separately, member search is `ILIKE '%q%'` on name/email/phone (`services/clients/manage.ts:143,232`) and receipts search likewise (`receipts/read.ts:127`), which no btree serves under any role.
- **At target load.** Admin member search reads all of a studio's clients per keystroke/search. Fine for a few thousand members per studio.
- **Fix.** Verify with `EXPLAIN` as `booking_app` (owner plans will differ — owners bypass RLS). If search becomes slow: `pg_trgm` GIN on `clients (name, email, phone)`. If the two `lower(name)` indexes show `idx_scan = 0` in `pg_stat_user_indexes`, drop them.

### DB-16 — P2 — CONFIRMED — Double booking of a class is prevented only by application locking; no unique index backs it
- **Evidence.** `services/bookings/book.ts:129-141`: `lockClass` (`FOR UPDATE`, `:303-319`) then `holdsSeat` then insert. Correct as long as every writer takes the class lock first (the comment at `:295-298` states that as a convention). Inventory: `bookings` has no unique index on `(class_id, client_id)` for live bookings — unlike `waitlist_entries`, which has `U(tenant_id, class_id, client_id) WHERE status = 'waiting'`. Same for workshops: `already_booked` is a read (`workshops/book.ts:105-118`) with no unique index on `(workshop_id, client_id)`.
- **At target load.** No known hole on the class path. It is a missing backstop: one future write path that skips `lockClass` produces duplicate seats silently.
- **Fix.** `CREATE UNIQUE INDEX bookings_one_seat_per_class ON bookings (class_id, client_id) WHERE state = 'confirmed' AND class_id IS NOT NULL` and the workshop equivalent — after checking existing data and that no legitimate flow (ClassPass, staff overbook) books one member twice.

### DB-17 — P2 — CONFIRMED (shape) / SUSPECTED (which are unused) — Index bloat on the write-hot tables
- **Evidence.** `bookings` carries 18 indexes, `classes` 15, `pt_requests` 14, `client_packages` 12. Migration `0074_foreign_key_indexes.sql` added a single-column index for every FK (113 statements) beside existing `(tenant_id, <fk>, …)` composites: e.g. `bookings_class_id_fk_idx (class_id)` + `bookings_class_state_idx (tenant_id, class_id, state)`; `bookings_pt_session_id_fk_idx` + `bookings_pt_session_idx (tenant_id, pt_session_id)`; `stripe_payments_purchase_id_fk_idx` + `stripe_payments_purchase_idx (tenant_id, purchase_id)`; `pt_request_slots_pt_request_id_fk_idx` + `pt_request_slots_request_idx`; and the same pair on all eight join tables (`class_rule_packages`, `*_supporting_instructors`, `workshop_tier_days`, …). Since ids are globally-unique UUIDs, `tenant_id` in front of an FK column adds no selectivity: one index `(<fk>, …)` would serve the FK check, the RLS-filtered query and the join. Likely-unused low-cardinality indexes: `bookings_check_in_state_idx (tenant_id, check_in_state)`, `email_log_status_idx`, `purchases_status_idx`, `clients_status_idx`, `leave_requests_status_idx`, `staff_auth_two_factors_secret_idx` / `platform_auth_two_factors_secret_idx` (an index on a secret).
- **At target load.** Every booking insert maintains 18 index entries and every booking update that touches an indexed column is a non-HOT update; harmless at 110 users, real WAL/vacuum cost as volume grows.
- **Fix.** After two weeks of production traffic, read `pg_stat_user_indexes` (`idx_scan = 0`) and drop the unused half of each pair. Prefer keeping `(<fk>, …)` without the `tenant_id` prefix where both exist. Add the two FK-leading indexes that are only partially covered: `client_packages (client_id)` and `promo_code_redemptions (promo_code_id)` (parent delete/update checks cannot use a partial index).

### DB-18 — P2 — CONFIRMED — Migrations build indexes non-concurrently, in one transaction, with no lock timeout
- **Evidence.** `grep CONCURRENTLY src/db/migrations/*.sql` → 0 hits across 42 migrations that create indexes (0074 alone builds 113). `migrate.ts:13` uses Drizzle's migrator, which applies all pending migrations in a single transaction, so `CREATE INDEX` takes a write-blocking lock held until the last pending migration finishes, and `CONCURRENTLY` is not possible inside it. No `lock_timeout` is set on the migration connection (`migrate.ts:9`).
- **At target load.** Harmless while tables are small. Once `bookings`/`email_log` are large, an index migration blocks every write to that table for the build — during a deploy the old server is serving through. And any `ALTER TABLE` waits indefinitely behind a long request transaction while queueing all other queries on the table behind itself.
- **Fix.** `SET lock_timeout = '5s'` on the migration connection (fail and retry rather than stall). Document a pattern for large-table indexes: a `--custom` migration run outside the transaction (a separate `db:migrate:concurrent` step executing `CREATE INDEX CONCURRENTLY IF NOT EXISTS`), with the schema declaring the index so the drift check stays green.

### DB-19 — P2 — CONFIRMED — `withTenant` does not detect nesting
- **Evidence.** `index.ts:58-85` always calls `pool.transaction`, never checking `scope.getStore()`. A `withTenant` reached from inside a request (which already holds a connection) would take a second connection while holding the first — the classic pool self-deadlock once ≥ `max` requests do it at once — and would run outside the request's transaction (its writes commit even if the request fails). I checked all 26 non-test call sites: none is currently reachable from inside a tenant request (they are platform routes, webhooks, jobs, CLIs and `runAfterCommit`, which runs after the outer commit). So this is a missing guard, not a live bug.
- **Fix.** In `withTenant`: if a scope is open for the same tenant, run `fn` in it (or as a savepoint); if open for a different tenant, throw.

### DB-20 — P2 — CONFIRMED — Shutdown is abrupt for anything not an HTTP request
- **Evidence.** `server.ts:37-55`: `server.close(cb)` → `closeDb()` (`index.ts:247`, `client.end({ timeout: 5 })`) → exit, with a 10 s forced exit. Cron tasks are never stopped, so a job can start a tenant step during the drain; after-commit mail for an in-flight request is in-memory only, so a deploy between COMMIT and send loses the email with no record (the `queued` row is in the uncommitted mail transaction, DB-02). `unhandledRejection` is logged and ignored (`:62-64`).
- **Fix.** Stop cron first, then drain HTTP, then `closeDb`. The outbox in DB-02 removes the lost-mail window. Align the 10 s cap with Docker's `stop_grace_period`.

### DB-21 — P3 — CONFIRMED — Three extra round trips per request, and one round trip per cron tenant step, for the tenant GUC
- **Evidence.** `index.ts:64-79`: `BEGIN`, then `select set_config(...)` as its own statement, then the work, then `COMMIT` — for every GET.
- **Fix.** Cheap on a same-host Docker network; if profiling shows it, send `BEGIN; SELECT set_config(…)` as one pipelined batch. Not worth doing before DB-01-03.

### DB-22 — P3 — CONFIRMED — Pool is not observable
- **Evidence.** `index.ts:27`: no `application_name`, no `onnotice`/`debug` hook, no gauge of busy/waiting connections; `retryingTransaction` logs retries (`:205-208`) but nothing logs a slow transaction or a queued acquire.
- **Fix.** Set `application_name`; log any `withTenant` that holds its connection > 1 s with route and tenant; export pool-in-use/waiting counts to the existing logger on an interval. This is how DB-01-05 get verified after the fix.

### DB-23 — P3 — CONFIRMED — `/health` shares the request pool and has no deadline
- **Evidence.** `app.ts:182-189`. When the pool is exhausted the probe hangs rather than answering 503, so a saturated-but-alive server and a dead one look the same to the deploy's `--wait` and to monitoring.
- **Fix.** Race the `SELECT 1` against a 2 s timer and return 503 `db: 'busy'`.

### DB-24 — P3 — CONFIRMED — Minor schema notes
- `client_packages_trial_unique_per_client` is `U(client_id) WHERE kind = 'trial'` and `rooms_location_name_lower_unique` is `U(location_id, lower(name))` — neither leads with `tenant_id`; correct (parent ids are tenant-owned) but inconsistent with migration 0040's convention.
- `check_ins`, `instructors`, `pt_packages`, `leave_pools`, `promo_code_products`, `pt_session_clients` have a bare `(tenant_id)` index as their only tenant index; on small tables Postgres will not use it. Harmless.
- Money columns are named `*_sgd` on a multi-tenant platform (currency baked into 31 column names). Out of slice; noted for the spec.
- `tenants_status_idx (status)` on a table with a handful of rows is dead weight.

---

## (d) Checked and fine

- **App role vs owner.** Runtime uses `DATABASE_APP_URL` only, required with no fallback (`index.ts:23-25`); role is forced `NOSUPERUSER NOBYPASSRLS` on every migrate (`roles.ts:53`). Owner connections are `max: 1` and short-lived.
- **Tenant context is transaction-local** (`set_config(..., true)`, `index.ts:78`) — it cannot leak to the next borrower of a pooled connection.
- **No second pool for Better Auth**; all three auth table sets go through the same `db` proxy, so sign-in runs under RLS in the request's Tenant context.
- **Policy is index-friendly in the common case**: `tenant_id = <stable expr>` is usable as an index condition, and every tenant-scoped table has a `tenant_id`-leading index; `uuid =` is leakproof.
- **New tables are fail-closed**: `ensureTenantIsolation` covers any table with a `tenant_id` without a per-table migration (the mechanism is right; its execution is DB-08).
- **FK index coverage** is complete bar the two partial-only cases in DB-17 (migration 0074).
- **Class booking concurrency**: class row `FOR UPDATE` before the double-book and capacity checks (`book.ts:129-145`); package rows locked `FOR UPDATE OF client_packages` before spending (`book.ts:486`); waitlist promotion uses `FOR UPDATE SKIP LOCKED` (`waitlist/promote.ts:81`).
- **Idempotency by unique index**: `bookings_purchase_unique`, `client_packages_purchase_unique`, `corporate_requests_purchase_unique`, `receipts_purchase_unique`, `stripe_payments_intent_unique`, `merch_orders_intent_unique`, `purchases_checkout_session_unique`, `bookings_classpass_reservation_unique`, `check_ins_booking_unique`, `waitlist_entries_one_waiting_unique`, `tenant_imports_one_running`.
- **Credit balance cannot go negative** (`client_packages_non_negative_balance` CHECK); capacities and time ranges are CHECK-constrained.
- **Deadlock/serialization retry** is bounded (4 attempts, jittered), savepoint-scoped, logs the operation name, and drops after-commit work of a failed attempt (`index.ts:197-244`).
- **Hot member read paths have matching indexes**: timetable `classes (tenant_id, starts_at)` / `(tenant_id, location_id, starts_at)`; seat counts `bookings (tenant_id, class_id, state)`; my bookings `bookings (tenant_id, client_id, booked_at)`; my packages `client_packages (tenant_id, client_id, kind|expires_at)`; credit history `credit_movements (tenant_id, client_package_id, created_at)`; session lookup `U(token)`; member lookup `clients U(tenant_id, auth_user_id)`; staff updates feed `(tenant_id, recipient_staff_id, read_at, created_at)`; pending PT expiry partial index.
- **Slug resolution** is memoised for 60 s, positive-only, and invalidated on tenant writes (`tenants.ts:64-73`).
- **Column types**: `timestamptz` throughout, `numeric(10,2)` money, `uuid` keys, enums for states.
- **Migrations are expand-only by rule** with a CI drift check and a pre-migration snapshot (`deploy-be.yml:750-769`).
- **Vendor calls have deadlines** (`lib/outbound.ts:36-41`) — they bound, but do not remove, the connection hold in DB-03.

## Cross-slice notes
- Auth/middleware: whether session validation costs 1-2 queries per request inside the transaction was not measured here.
- Server pipeline: the global 60-minute `requestTimeout` (`server.ts:19-21`); `unhandledRejection` swallowed.
- Cron/integrations: DB-05 (job fan-in), the send gate's per-send quota query (DB-09), Stripe webhook retries holding a connection (DB-03).
- Client/portal routes: per-route audit for DB-04 (write then throw outside a savepoint) and DB-03 (vendor call inside the request transaction).
