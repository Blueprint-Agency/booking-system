# Audit 7 — per-request pipeline, auth, tenant resolution, deployment shape

Scope: `be/src/app.ts`, `be/src/middleware/*`, route index files, `services/auth/*`, `services/tenants/*`, `services/feature-flags.ts`, `services/impersonation/*`, `lib/*`, `db/index.ts` (only as the pipeline uses it), `be/Dockerfile`, `be/package.json`, `.github/workflows/deploy-be.yml`, `docs/md/deployment.md`, `docs/md/observability-*.md`.

Read-only. Nothing was run against a server or database. Library behaviour was read from the installed packages (`better-auth` 1.7.4, `postgres` 3.4.9, `hono` 4.13.7, `hono-rate-limiter` 0.4.2).

Not available in this repo, so anything depending on it is marked SUSPECTED: the production compose file, Traefik config, container memory/CPU limits, Postgres tuning, log rotation and the backup job. They live in the infrastructure repo (`vps/bpvps2/stacks/booking/docker-compose.yml`, per `docs/md/observability-runbook.md:60-61`).

Paths below are relative to the repository root.

---

## A. How it works

### A.1 Global chain (every request, `be/src/app.ts`)

| # | Step | Where | DB cost |
|---|---|---|---|
| 1 | `requestId`: takes `x-request-id` or a UUID, opens the log AsyncLocalStorage | app.ts:32, middleware/request-id.ts:17-22 | 0 |
| 2 | `requestLogger`: one `info` access line per request | app.ts:33, middleware/logger.ts:30-43 | 0 |
| 3 | `errorBoundary` + `onError` | app.ts:34-35, middleware/error.ts | 0 |
| 4 | `secureHeaders()` | app.ts:36 | 0 |
| 5 | `cors(...)`: answers OPTIONS here, so a preflight stops at this step | app.ts:46-66 | 0 |
| 6 | `maintenanceGate` on `/api/v1/*` (exempt: healthz, webhooks, platform, slug lookup) | app.ts:90, services/platform/maintenance.ts:45-56 | 0 per request; 1 `SELECT platform_settings` per 5 s per process, on the bare pool |
| 7 | `hono-rate-limiter` by prefix, in memory: public 100/min, slug lookup 6000/min, me/portal/platform 300/min | app.ts:92-122 | 0 |
| 8 | `resolveTenant` on `/api/v1/*` (exempt list at app.ts:153-166) | middleware/tenant.ts:56-103 | slug to tenant: 0 on a cache hit, 1 join query per slug per 60 s (services/tenants/tenants.ts:64-65, 117-136). Then `withTenant`: **BEGIN + `select set_config('app.tenant_id', …, true)`**, and **COMMIT** on the way out (db/index.ts:64-80). One pooled connection is held from here until the response is finished |
| 9 | `requireActiveTenant` (me, portal) / `requireActiveTenantForMembers` (public, client auth pool) | app.ts:195-198, middleware/require-active-tenant.ts:24-45 | 0 on a cache hit; 1 `SELECT tenants` per tenant per 60 s (tenants.ts:92-97) |

Origin corroboration (tenant.ts:57-71) and the session-claim check (tenant.ts:162-171) are pure string comparisons with no I/O.

### A.2 The four request shapes

Round trips are counted to Postgres, on a warm cache, before and after the handler's own queries.

**(a) Public request** (`/api/v1/public/*`, other than the slug lookup)

```
requestId → logger → errorBoundary → secureHeaders → cors → maintenanceGate(cache)
→ publicLimiter(memory) → resolveTenant[cache] → BEGIN → set_config
→ requireActiveTenantForMembers[cache] → handler → COMMIT
```
3 round trips of overhead, 1 connection.

The slug lookup `/api/v1/public/tenants/by-slug/:slug` skips tenant context entirely: 0 round trips on a cache hit (app.ts:109-119, 166; routes/public/tenants.ts:50-56).

**(b) Authenticated member** (`/api/v1/me/*`, routes/client/index.ts:18-21)

```
… → authedLimiter(memory) → resolveTenant → BEGIN → set_config → requireActiveTenant[cache]
→ clientAuth:
     readPoolSession('client')  → SELECT client_auth_sessions WHERE token = ?   (1)
                                → SELECT client_auth_users WHERE id = ?         (2)
     SELECT * FROM clients WHERE tenant_id = ? AND auth_user_id = ?             (3)
→ requireActiveClient (in memory) → clientImpersonation (JWT verify only when the header is present)
→ audit (no-op for a member's own request) → [checkoutRateLimit on /checkout/*] → handler → COMMIT
```
**6 round trips of overhead** (BEGIN, set_config, session, user, clients, COMMIT), 1 connection.

**(c) Admin** (`/api/v1/portal/admin/*`, routes/portal/index.ts:63-75, admin/index.ts:39-40)

```
… → resolveTenant → BEGIN → set_config → requireActiveTenant[cache]
→ staffAuth: session (1) + user (2) + SELECT * FROM staff_users (3); permissions resolved in memory for an admin
→ requireActiveStaff → impersonate (+1 SELECT only when x-impersonate-staff-id is sent)
→ audit → requireRole('admin') → handler → [audit INSERT on a successful POST/PUT/PATCH/DELETE] → COMMIT
```
**6 round trips** on a read, **7** on a write (the audit row), 8 when impersonating.

**(d) Instructor** (`/api/v1/portal/instructor/*`)

Same as (c) plus one `SELECT instructors.permissions` (middleware/staff-auth.ts:91, services/auth/instructor-permissions.ts:24-28). **7 round trips** on a read, **8** on a write.

**Platform (super portal):** no tenant context. Session + user = 2 autocommit queries on the bare pool (middleware/platform-admin.ts:62-79).

**Why the session read is two queries:** `readPoolSession` calls Better Auth's `getSession`, which calls `findSession` with `join: { user: true }`. The adapter only issues a real join when `advanced.database.joins` is set; otherwise it falls back to separate queries (`node_modules/better-auth/node_modules/@better-auth/core/dist/db/adapter/factory.mjs:562`). The option is not set anywhere in `services/auth/better-auth.ts:210-230`.

### A.3 Overhead at the target load

Per authenticated request: 6 statements, of which 3 are transaction framing and 3 are identity lookups that repeat unchanged on every call from the same user.

The request rate depends on how many API calls each page makes, which the frontend auditors own. As a formula: `overhead statements/s = 6 × requests/s`. If 110 users each trigger about 5 API calls per navigation and navigate every 10 s, that is about 55 requests/s, so about 330 overhead statements/s, plus up to 55 OPTIONS preflights/s (finding F-03). Postgres absorbs that easily; every statement is a unique-index or primary-key lookup. The cost that matters is not query count but how long each request holds one of ten connections (F-01).

### A.4 Better Auth configuration as built

- Three `betterAuth()` instances, all on the same `db` proxy and therefore the same single postgres.js pool (better-auth.ts:234, 319; db/index.ts:27-28). There are no per-pool Postgres connections.
- Sessions: no `session` options set, so library defaults apply: 7-day expiry, `updateAge` 1 day (`dist/context/create-context.mjs:147-148`). A session row is written at most once a day per session (`dist/api/routes/session.mjs:180-199`), not per request.
- Cookie cache: off, and it could not help, because `readPoolSession` deliberately passes only the `Authorization` header (better-auth.ts:463-465).
- Rate limiting: enabled in all environments, in-memory custom storage, one map per pool (services/auth/rate-limit.ts:55-97). It applies to `auth.handler` calls only, not to `api.getSession`.
- Password hashing: scrypt N=16384, r=16, p=1 through `node:crypto` on the libuv thread pool (`node_modules/@better-auth/utils/dist/password.node.mjs`), about 32 MB per hash. Legacy bcrypt digests are verified with `bcryptjs` (services/auth/password-hash.ts:21-24).
- Audit: one `auth_events` INSERT per sign-in, failed sign-in, code sent, code failed, sign-out, and impersonation start/end (services/auth/auth-events.ts:37-52, 134-153). Nothing per ordinary request.

### A.5 Deployment topology (from the repo)

```
Browser ──► Vercel (fe-client / fe-portal, Next.js) ──server-side──► GET /public/tenants/by-slug (cached in the FE process)
   │
   └── cross-origin fetch, Bearer token + X-Tenant-Slug ──► Traefik on bpvps2 (TLS)
                                                               └─► booking-be container: ONE Node 22 process, `tsx src/server.ts`
                                                                     ├─ HTTP (Hono on @hono/node-server)
                                                                     ├─ node-cron jobs, same process
                                                                     ├─ mail send gate, same process
                                                                     └─ postgres.js pool, default max 10 ──► db-booking (postgres:16 container, same Docker network)
```

- Staging and production are two stacks on the same VPS and the same Docker daemon (deploy-be.yml:208-212, 715-725).
- Deploy: build image, pre-migration DB snapshot, migrate + seed in a one-off container, boot a smoke container against the real env and DB, then `docker compose up -d --wait` which recreates the one container (deploy-be.yml:953-1046).
- Observability: Pino JSON to stdout, Alloy to Loki, Grafana alerts to Discord, synthetic checks on `/health` (observability-runbook.md).

---

## B. Findings

Severity: P0 breaks or corrupts at the target load; P1 real cost or risk at the target load; P2 waste or best practice; P3 nit.

### F-01 — P1 — CONFIRMED (mechanism), SUSPECTED (how often it bites) — Ten connections, one held for each request's whole life

Evidence:
- `be/src/db/index.ts:27` is `postgres(url)` with no options. postgres.js defaults to `max: 10`.
- `middleware/tenant.ts:102` wraps the rest of the request in `withTenant`, one transaction on one connection (db/index.ts:64-80). The file says so itself: "a request holds a pooled connection for its whole life, including any Stripe or mail call inside it" (db/index.ts:51-53).
- After-commit work (email) runs in a further `withTenant` per item, sequentially, and is awaited before the response is returned (db/index.ts:83, 120-130). The mail call inside it goes through a gate paced at 8 sends/s (lib/send-gate.ts:42, 281-287), so that connection is held across the queue wait and the Resend call.
- Cron jobs share the same pool (jobs/index.ts:163-175).
- `/health` runs `SELECT 1` on the same pool (app.ts:182-189).

At 100 members + 10 admins: with fast handlers (about 20 ms) ten connections carry several hundred requests/s, so normal browsing is fine. The pool saturates as soon as about ten requests are simultaneously slow: checkouts calling Stripe inside the transaction, a booking burst where each request waits on its confirmation email, a finance report, an export, an R2 upload, a studio import, a cron sweep. When that happens every other request queues behind them, including `/health`, so the synthetic check can go red and report "API down" while the process is merely waiting. This is the first bottleneck in the current shape.

Fix:
1. Set the pool explicitly: `postgres(url, { max: 30, idle_timeout: 30, connect_timeout: 10 })`, sized against the database's `max_connections` (postgres:16 default is 100, shared with migrations and the backup job; confirm in the infra repo).
2. Stop awaiting email before answering: hand after-commit mail to a background queue so the request returns at COMMIT and no connection is held across a Resend call.
3. Keep vendor calls (Stripe session creation, R2) outside the tenant transaction, as the comment at db/index.ts:53-54 already recommends.
4. Give `/health` a 1-2 s timeout, or a dedicated `max: 1` client, so pool saturation is not reported as a dead database.
5. Set `idle_in_transaction_session_timeout` and `statement_timeout` on the `booking_app` role in `db/roles.ts`; neither is set today (roles.ts:48-53 only sets the password and privilege flags), so a hung handler pins a connection indefinitely.

### F-02 — P1 — CONFIRMED — The "authenticated" rate limiter is keyed on IP, not on the user; a studio's wifi shares one budget

Evidence:
- `authedLimiter` is mounted at app level (app.ts:97-102, 120-122), before `clientAuth` / `staffAuth` run inside the route trees. `c.get('clientId')` and `c.get('staffUserId')` are therefore always undefined when the key is computed, and the key falls through to `x-forwarded-for`.
- The repo states this itself: "the app's limiters run before any auth and only ever see the address" (middleware/checkout-rate-limit.ts:21-23).
- `publicLimiter` is 100/min per IP (app.ts:92-96) and covers the catalogue, the sign-in steps and the 30-second maintenance re-check.
- With no `x-forwarded-for` at all, every caller shares the single key `'global'` (app.ts:95, 101).

At 100 members + 10 admins: members arriving for a class are on the studio's wifi, so one NAT address. Thirty members at about 10 calls/min each reach the 300/min budget; the front desk's admins on the same network spend from the same budget. The result is 429s for a whole studio at exactly its busiest moment. The public budget of 100/min is reached sooner.

Fix: split the limiter in two. Keep a coarse per-IP limiter before auth, with a budget sized for a studio NAT (for example 1,500-3,000/min). Add a per-user limiter after auth, keyed `tenantId:clientId` or `tenantId:staffUserId`, mounted inside `routes/client/index.ts` and `routes/portal/index.ts` the way `checkoutRateLimit` already is. Replace the `'global'` fallback with a refusal or a clearly separate bucket. Confirm in the infra repo that Traefik overwrites client-supplied `X-Forwarded-For`; otherwise the key is spoofable.

### F-03 — P1 — CONFIRMED — No `Access-Control-Max-Age`: almost every API call costs an extra OPTIONS round trip

Evidence: the `cors({...})` call at app.ts:46-66 sets no `maxAge`, so Hono sends no `Access-Control-Max-Age`. Browsers then cache a preflight for about 5 seconds. Every API call carries `Authorization` and `X-Tenant-Slug` (fe-client/src/lib/api.ts:80-90), which are non-simple headers, so every call is preflighted. The API and the frontends are on different origins (deployment.md:14-24).

At the target load: up to double the HTTP requests reaching Traefik and Node, an extra network round trip of latency on most user actions (felt most on mobile), and one extra access-log line per preflight (logger.ts:42 logs OPTIONS like anything else).

Fix: add `maxAge: 86400` to the CORS options (Chrome caps at 2 h, Firefox at 24 h). Skip the access-log line for OPTIONS.

### F-04 — P1 — CONFIRMED — Six statements of fixed overhead per authenticated request; three are identity lookups that never change between calls

Evidence: chain (b)-(d) in section A.2. Specifically:
- Session and user are fetched as two queries because `advanced.database.joins` is unset (better-auth.ts:210-230; factory.mjs:562).
- `clients` / `staff_users` is a third query with `select()` of the whole row (client-auth.ts:55-59, staff-auth.ts:66-76).
- An instructor's permissions are a fourth (staff-auth.ts:91).
- BEGIN and `set_config` are two awaited round trips before any work (db/index.ts:64-78).

At the target load: about 330 statements/s of pure overhead at 55 requests/s (section A.3), and each one extends the time a pooled connection is held.

Fix, in order of value:
1. Set `advanced: { database: { joins: true } }` in `shared()` so session + user is one query. Run the auth and isolation suites, since Better Auth documents the option as newer than the fallback.
2. Better: replace the three reads with one hand-written query that joins session, auth user and `clients` (or `staff_users` left-joined to `instructors`) on the token, in the two auth middlewares. One round trip instead of three or four.
3. Optionally cache the resolved identity in process for 15-30 s, keyed on a hash of `tenantId + pool + token`, and clear it on sign-out, block, archive, role change and permission change. This trades the "revocation is felt on the very next request" guarantee documented at staff-auth.ts:17-21 for a bounded delay, so it needs an explicit decision; option 2 has no such trade-off.
4. Send `set_config` without awaiting BEGIN's result so postgres.js pipelines the two into one network round trip.

### F-05 — P1 — CONFIRMED (mechanism), SUSPECTED (magnitude) — A request's response waits for its emails, sent one after another

Evidence: `withTenant` awaits `runAfterCommit` before returning (db/index.ts:83). `runAfterCommit` runs each item in sequence, each in its own transaction (db/index.ts:120-130). Each send waits its turn in a gate paced at 8/s shared by the whole process (lib/send-gate.ts:42), then awaits Resend, then runs a cross-tenant `COUNT` of today's `email_log` inside a savepoint (lib/send-gate.ts:268-276, lib/mailer.ts:144-154): three more round trips per email.

At the target load: an admin cancelling a class with 30 bookings waits for 30 sequential sends before the portal gets its answer (several seconds at best), with a connection pinned throughout. Concurrent bookings queue behind each other in the gate. The integrations auditor owns the mail path; it is listed here because it sets response latency for every write that notifies someone.

Fix: return the response at COMMIT and deliver mail from a background worker (an outbox table drained by the existing process is enough). Read the daily count from an in-memory counter refreshed periodically instead of one `COUNT` per send.

### F-06 — P1 — SUSPECTED — Mail quota constants are the Resend Free plan's: 100/day, 3,000/month

Evidence: lib/send-gate.ts:45-47 hard-codes `DAILY_QUOTA = 100` and `MONTHLY_QUOTA = 3000` with the comment "Resend Free's caps". These drive only the warning thresholds; the real cap is whatever plan the account is on, which the repo cannot show.

At the target load: if the account really is on the free plan, 100 members booking across several studios exhaust 100 emails/day within hours, after which sign-in codes, password links and staff second-factor codes stop too (the file says so at send-gate.ts:21-24). If the account is on a paid plan, the constants are wrong and the `mail_quota_daily_high` warning fires for nothing.

Fix: confirm the plan. Move the two figures to env or to the value Resend returns, and treat a paid plan as a launch prerequisite.

### F-07 — P1 — CONFIRMED — Deploys are not zero-downtime, and the smoke test boots a second full server with cron jobs against the live database

Evidence:
- One container per stack is recreated in place by `docker compose up -d --wait` (deploy-be.yml:1044). The workflow notes "Traefik 404s only when NO container is running for that host" (deploy-be.yml:992-993); between stopping the old container and the new one listening there is none. Boot includes tsx transpiling the whole source tree (F-09).
- The smoke container runs the real image with the real env on the stack's network (deploy-be.yml:997-1000). `server.ts:25-32` always registers the cron jobs, and deployment.md:526 says "run one backend instance per database". For up to 40 s (20 tries × 2 s) two instances with two cron schedulers and two mail gates run against one database.
- Shutdown force-exits after 10 s (server.ts:51-54), which matches Docker's default stop grace period. In-flight requests longer than that, and any cron run in progress, are cut.
- Migrations run before the swap, so the old build serves against the new schema for "the minute or so until the new container is up" (deployment.md:484-486).

At the target load: each production deploy drops in-flight requests and returns errors for several seconds; a 5-minute cron tick landing inside the smoke window runs twice.

Fix: add an env switch that disables jobs (and set it for the smoke container). Start the new container alongside the old one behind Traefik and stop the old one only after the new one is healthy (two service names or `--scale` with a health-checked Traefik load balancer). Raise `stop_grace_period` to about 30 s and the forced-exit timer with it.

### F-08 — P1 — CONFIRMED — No request body limit, and a 60-minute request timeout on every route

Evidence: `bodyLimit` appears only on three upload routes (routes/profile-picture.ts:26, routes/portal/leave.ts:109, routes/portal/admin/merch.ts:87). Nothing global is mounted in app.ts. `server.ts:19-21` sets `requestTimeout` to 60 minutes for the whole server because the studio import can be 1 GB.

At the target load: any caller, authenticated or not, can post an arbitrarily large JSON body that `c.req.json()` buffers in the one Node process, or trickle a body for an hour while holding a pooled connection (the tenant transaction is already open). The deploy workflow records that this box has already been OOM-killed by a second tsx process (deploy-be.yml:977-980), so memory headroom is small.

Fix: mount `bodyLimit({ maxSize: 1 MB })` on `/api/v1/*` with explicit larger limits on the upload and import routes. Keep the default 5-minute request timeout for the server and handle the import route's long upload separately (a presigned direct-to-R2 upload removes the need entirely). Whether Traefik buffers or caps bodies is in the infra repo.

### F-09 — P2 — CONFIRMED — Production runs TypeScript sources through tsx, as root, from an image that carries every dev dependency

Evidence: `be/Dockerfile:5-12`: `npm ci --include=dev`, `CMD ["node_modules/.bin/tsx", "src/server.ts"]`, no `USER`, no `HEALTHCHECK`. `package.json:10-13`: `build` is `tsc --noEmit`, `start` is `tsx src/server.ts`. `COPY src ./src` ships `src/test`, `src/e2e` and the seeds into the production image.

Cost: slower cold start on every deploy (extends the F-07 gap), esbuild and its memory in the runtime process (the OOM note at deploy-be.yml:977-980), `playwright-core`, `drizzle-kit` and `pino-pretty` in the production image, a root process, and stack traces that depend on tsx's in-memory source maps.

Fix: a two-stage Dockerfile. Stage 1 compiles (`tsc` to `dist/`, or an esbuild bundle) with source maps. Stage 2 installs production dependencies only, copies `dist/` and the migrations, sets `USER node`, and runs `node --enable-source-maps dist/server.js`. Keep a separate migrate image or a compiled migrate entry point.

### F-10 — P2 — CONFIRMED — Single process by construction; eight pieces of process-local state block a second instance

Evidence, each explicitly relying on "one process":
- hono-rate-limiter memory stores (app.ts:92-115, middleware/checkout-rate-limit.ts:26-30)
- Better Auth rate-limit maps (services/auth/rate-limit.ts:43-75)
- sign-in step and staff link budgets (rate-limit.ts:130, 154)
- platform first-sign-in cooldown (services/auth/platform-first-sign-in.ts:34-35)
- tenant caches, invalidated only in the process that wrote (services/tenants/tenants.ts:64-73)
- feature-flag cache (services/feature-flags.ts:13)
- maintenance cache (services/platform/maintenance.ts:37, 78-79)
- the mail send gate ("One process only", lib/send-gate.ts:33-34)
- cron jobs registered in every server process (server.ts:25, deployment.md:526)
- provider-credentials and mail-identity caches (services/billing/provider-credentials.ts:57, services/tenants/mail-identity.ts:42)

At the target load: one Node process on one core is enough for 110 users provided the pool (F-01) and the event loop (F-11) are kept clear. But there is no way to add a second instance for capacity or for a rolling deploy (F-07) without rate limits halving in strictness, cron and mail pacing doubling, and suspensions or flag changes taking up to a minute to reach the other process.

Fix: not required for the target load. Record it as the scaling ceiling. The cheapest first steps are a jobs on/off env switch and moving cache invalidation to Postgres `LISTEN/NOTIFY`.

### F-11 — P2 — CONFIRMED (mechanism), SUSPECTED (magnitude) — Password checks run inside the tenant transaction; legacy bcrypt runs on the event loop

Evidence: `/api/v1/auth/{client,staff}/*` and the in-process member sign-in run inside `resolveTenant`'s transaction (app.ts:168-170, 221-223; better-auth.ts:653-662). scrypt at N=16384, r=16 runs on the libuv pool, whose default size is 4, and nothing sets `UV_THREADPOOL_SIZE` (Dockerfile, deploy-be.yml:864-942). Legacy digests go through `bcryptjs` (password-hash.ts:22), which is pure JavaScript on the main thread.

At the target load: sessions last 7 days, so sign-ins are infrequent. In a burst (start of class, or after a `BETTER_AUTH_SECRET` rotation signs everyone out) more than 4 concurrent sign-ins queue on the thread pool, each holding one of the ten connections and about 32 MB while it waits. Each bcrypt verification blocks every other request for its duration.

Fix: set `UV_THREADPOOL_SIZE=8` (or the core count). Replace `bcryptjs` with native `bcrypt`, or rehash to scrypt on first successful sign-in so the legacy path empties itself. Raising the pool (F-01) removes the connection pressure.

### F-12 — P2 — CONFIRMED — Sign-in budgets per IP are small for a studio's shared wifi

Evidence: `signInAttempt: { window: 60, max: 10 }` and `codeRequest: { window: 60, max: 5 }` per address per pool (services/auth/rate-limit.ts:16-28). Member sign-in forwards the caller's `x-forwarded-for` into the pool (better-auth.ts:631, 665-672), so the per-address budget applies. The email step allows 20/min per address (rate-limit.ts:128).

At the target load: more than ten members signing in from one studio's network inside a minute are refused. It happens only when many sessions expire together, so it is rare, but it lands on a full class.

Fix: keep the per-email budgets (they are per tenant and are what actually stops guessing) and raise the per-address ones to match a class size, for example 40/min.

### F-13 — P2 — CONFIRMED — Nothing prunes expired sessions, `auth_events` or `audit_log`

Evidence: no job in `jobs/index.ts:120-175` touches the auth tables. The only deletes of sessions outside Better Auth are in tenant deletion (services/tenants/delete.ts:51-58). Better Auth removes an expired session only when that token is presented again (`dist/api/routes/session.mjs:153-162`). Expired verifications are swept by Better Auth on each verification lookup (`dist/db/internal-adapter.mjs:753-757`), so those are fine. `auth_events` and `audit_log` only grow (one audit row per successful staff write, middleware/audit.ts:79-90).

At the target load: slow, unbounded growth: one session row per sign-in per device forever, one audit row per admin write. No effect for months; later it inflates backups and every index on those tables.

Fix: a daily job per tenant that deletes `*_auth_sessions` where `expires_at < now() - interval '7 days'`, and a stated retention for `auth_events` and `audit_log` (delete or archive past N months).

### F-14 — P2 — CONFIRMED — Studio slugs are written to logs, against the documented rule

Evidence: the runbook's rule is "Tenant ids, never names or slugs" (observability-runbook.md:10-14). But:
- the access line logs the raw path (middleware/logger.ts:42), which contains the slug for `/api/v1/public/tenants/by-slug/<slug>` and `/api/v1/webhooks/stripe/<slug>` (app.ts:109, 160);
- `tenant.ts:66-69` logs `headerSlug`, `originSlug` and the full `origin`;
- `require-active-tenant.ts:37-40` logs `slug`.

Fix: log the route pattern instead of the raw path for those two routes (Hono exposes `c.req.routePath`), and drop the slug fields in favour of `tenantId`.

### F-15 — P2 — CONFIRMED — Feature flags are loaded once at boot, after the server is already listening, and a failed load is only logged

Evidence: `serve(...)` opens the socket at server.ts:21; the flag cache is primed later inside `registerJobs()` (server.ts:25-32, jobs/index.ts:163-165). A failure is caught and logged (server.ts:30-32). `isEnabled` treats a missing entry as off (services/feature-flags.ts:35-37).

Impact: for the first moments after every deploy, and for the whole life of the process if the boot load fails, every studio's flags read as off, which silently disables the waitlist (services/waitlist/line.ts:28).

Fix: prime the cache before `serve()`, fail boot if it cannot be loaded, and reload it on a timer (60 s) so a row changed outside this process is picked up.

### F-16 — P2 — SUSPECTED — No response compression or conditional caching in the app

Evidence: no `compress()` or `etag()` middleware anywhere in `be/src` (grep). Whether Traefik compresses is in the infra repo.

Impact: catalogue, timetable and roster JSON goes out uncompressed unless Traefik does it; over mobile data that is latency on the largest responses.

Fix: enable Traefik's `compress` middleware on the router (preferred, keeps CPU off the Node process) or mount `hono/compress`. Add `Cache-Control` / ETag to the public catalogue reads.

### F-17 — P3 — CONFIRMED — The liveness probe is access-logged; the skip list names a path that does not exist

Evidence: logger.ts:38 skips `'/health'` and `'/healthz'`. The liveness route is `/api/v1/healthz` (app.ts:180), so it is logged on every probe.

Fix: compare against `/api/v1/healthz`.

### F-18 — P3 — CONFIRMED — `requireActiveTenant` re-loads the tenant row the resolver already has

Evidence: `resolveTenant` holds the full row (tenant.ts:96-99) but stores only the id; `requireActiveTenant` calls `loadTenantById` (require-active-tenant.ts:26), a second cache with its own 60 s expiry (tenants.ts:65-67), costing one extra query per tenant per minute inside the request's transaction.

Fix: `c.set('tenant', resolved.tenant)` in the resolver and read it in the gate.

### F-19 — P3 — CONFIRMED — Client-supplied `x-request-id` is trusted without validation

Evidence: request-id.ts:18 takes the header as is, echoes it and stamps it on every log line.

Fix: accept it only if it matches a short safe pattern (for example 8-64 characters of `[A-Za-z0-9-]`); otherwise generate one. Add `X-Request-Id` to `exposeHeaders` (app.ts:64) so the browser can actually read it.

### F-20 — P3 — SUSPECTED — `credentials: true` in CORS although sessions are bearer-only

Evidence: app.ts:50 against the comment at app.ts:45 and better-auth.ts:65-67. The API and every studio hostname share one registrable domain, so they are same-site to each other.

Fix: drop `credentials: true` unless a frontend call needs it, and confirm no frontend fetch uses `credentials: 'include'`.

### F-21 — P3 — CONFIRMED — Unauthenticated `GET /` identifies the service

Evidence: app.ts:172-177 returns `{ name: 'reservetoday-be', status: 'running' }`. Harmless; remove or return 404.

### Cross-slice notes (not investigated further)

- `npm run db:seed` runs on every deploy, both branches (deploy-be.yml:985). It skips fixture tenants only when `APP_ENV === 'production'` (db/seed/tenants.ts:43), so staging, which "holds the real member data" (deploy-be.yml:959), is seeded with the two fixture studios. For the DB auditor.
- Session tokens live in `localStorage` and the frontends' CSP still allows `'unsafe-inline'` scripts (deployment.md:473, 616-619). For the frontend auditors.
- Whether cron jobs are safe to run twice concurrently (F-07) is for the cron auditor.

---

## C. Can the current shape serve 110 concurrent users?

Yes for ordinary browsing and booking, on one process, with the code as it is. CPU and query volume are not the limit.

The first bottleneck is the ten-connection pool combined with one connection held per request for its whole life, including time spent waiting on Stripe and on paced email (F-01, F-05). The first user-visible failure is likely to be 429s for a studio whose members share one wifi address (F-02). Both are small changes.

Unknown from this repo and worth confirming in the infra repo before launch: container memory limit (there is one recorded OOM kill), Postgres `max_connections` and memory settings, Traefik compression and timeouts, Docker log rotation, the Resend plan.

---

## D. Checked and fine

- **No session write per request.** Refresh happens at most once a day per session (`updateAge` default; session.mjs:180-199).
- **Tenant slug lookup is cached** for 60 s, positive-only so unknown slugs cannot fill memory, and cleared on every tenant write: status, term, rename, delete, provision, business details (tenants.ts:64-73 and its nine call sites).
- **Maintenance check costs no query per request** (5 s shared promise; keeps the last answer if the read fails; maintenance.ts:45-56).
- **No cross-tenant bleed in any in-process cache.** Every cache is keyed by tenant id or by slug: tenant caches, feature flags (`tenantId:key`, feature-flags.ts:15), provider credentials, mail identity, Stripe clients (account id + key digest, lib/stripe.ts:88-91), checkout limiter (`tenantId:clientId`), per-email auth budgets (`tenantId|email`).
- **Tenant context is transaction-local** (`set_config(..., true)`, db/index.ts:78) and carried by AsyncLocalStorage, so it cannot ride a pooled connection into another request. Log context is also per-request AsyncLocalStorage (shared/logger.ts:42-56).
- **Header slug is corroborated before lookup** (tenant.ts:65-71) and the session's tenant claim is checked before any row is read (client-auth.ts:50-51, staff-auth.ts:61-62).
- **Error handler leaks nothing**: an unknown error returns `internal_error` and a request id only; the stack goes to the log (middleware/error.ts:45-51).
- **Better Auth rate limiting is on in every environment**, with separate stores per pool and per-email budgets per tenant (rate-limit.ts:87-97, 193-215). Sign-up is disabled on all pools (better-auth.ts:259, 337).
- **Rate limiters run before tenant resolution**, so a flood of forged slugs is throttled before it reaches a query or opens a transaction (app.ts:117-170).
- **The app connects as the non-owner role** with no fallback to the owner URL (db/index.ts:23-25).
- **`NODE_ENV=production` is set** in the image and the env file; JSON logging without the pretty transport (Dockerfile:8, deploy-be.yml:866, logger.ts:84).
- **Dev-only paths are not reachable over HTTP.** The e2e studio is a CLI that refuses production (e2e/guard.ts:10-14); `setClock` is called by nothing in the app (lib/clock.ts:26-32); `STRIPE_API_URL` is refused at boot in production (env.ts:143-149). No debug or seed routes exist.
- **No unused runtime dependencies** in `be/package.json`: every entry under `dependencies` is imported by non-test code.
- **Deploy safety**: tests, drift check and browser journeys gate the deploy; a database snapshot precedes every migration; the new image is smoke-tested before the live container is touched; rollback is by commit sha (deploy-be.yml:692-710, 955-973, 987-1038).
- **Graceful shutdown exists**: SIGTERM drains HTTP, closes the pool, with a forced exit as a backstop (server.ts:36-58).
- **Secure headers** are applied to every API response (app.ts:36).
- **CSRF** is not applicable to the bearer-token design, since no ambient credential is accepted by the middlewares (better-auth.ts:455-465).
