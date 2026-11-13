# Spec — production readiness at 100 members + 10 staff

**Status:** proposed. Nothing in this document has been implemented.
**Date:** 2026-11-13.
**Question it answers:** what happens when about 100 members and 10 admins use the platform at the same time, what is wasteful or unsafe for production, and what has to change.

## 1. How this was produced, and what it is not

Seven read-only audits ran in parallel, one per slice. Each read the code and wrote a report with file-and-line evidence. Those reports are kept beside this spec as its evidence:

| Prefix used here | Slice | Report | Findings |
|---|---|---|---|
| `DB-nn` | Connection pool, RLS, indexes, migrations | `production-readiness/audit-1-db.md` | 24 |
| `M-` `J-` `W-` `O-` `S-` | Mail, cron jobs, webhooks, outbound calls, server process | `production-readiness/audit-2-jobs-integrations-server.md` | 42 |
| `API-Fnn` | Member and public API (`F01`–`F30` in the report) | `production-readiness/audit-3-member-api.md` | 30 |
| `A-` `B-` `C-` `D-` `E-` | Staff and super-portal API | `production-readiness/audit-4-portal-api.md` | 72 |
| `FEC-Fn` | Member app `fe-client/` (`F1`–`F21` in the report) | `production-readiness/audit-5-fe-client.md` | 21 |
| `FEP-nn` | Staff app `fe-portal/` (`F-01`–`F-28` in the report) | `production-readiness/audit-6-fe-portal.md` | 28 |
| `PIPE-nn` | Request pipeline, auth, deployment (`F-01`–`F-21` in the report) | `production-readiness/audit-7-auth-pipeline-deploy.md` | 21 |

Limits of the evidence:

- **Nothing was run.** No load test, no `EXPLAIN`, no bundle analysis. Query counts are read off the code. Latency and plan claims are marked SUSPECTED in the reports and need the measurements in §7.
- **The infra repo was not read.** Postgres `max_connections`, the container memory limit, Traefik compression and timeouts, Docker log rotation and the Resend plan are not in this repository (§8).
- **The portal API audit was only spot-checked by its own author.** It verified C-01 and the super-portal findings; the other portal findings came from sub-passes it did not re-read line by line.
- **The frontend audits did not read every file.** They read every data-fetching path; the staff app's ~370 files were not all read line by line.
- **Re-verified for this spec** against the code, after the reports came back: the pool defaults (`be/src/db/index.ts:27`), the limiter mounted before auth (`be/src/app.ts:97-122`), the missing CORS max-age (`app.ts:46-66`), commit-on-throw (Hono's `compose.js` plus `middleware/tenant.ts:102`), the unlocked credit adjustment (`services/packages/adjust.ts:82-109`), the unlocked workshop capacity check (`services/workshops/book.ts:96-136`), the policy drop-and-recreate loop (`db/roles.ts:170-187`), the unlocked corporate scheduling (`services/corporate/requests.ts:310-364`), the smoke container (`deploy-be.yml:792-795`), the Free-plan constants and runbook (`lib/send-gate.ts:44-46`, `email-deliverability-runbook.md:4,14`), and the 60-minute request timeout (`server.ts:19`). Everything else rests on the reports.

Severity, as used throughout: **P0** breaks or blocks at the target load; **P1** a real cost or risk at the target load; **P2** waste or a best-practice gap; **P3** a nit.

## 2. Verdict

For ordinary browsing and booking, one backend process and one Postgres can carry 100 members and 10 staff. Query volume and CPU are not the limit: the per-request overhead is about six cheap indexed statements, and the pipeline audit estimates roughly 55 requests a second at this load.

The platform is not ready for that load as it stands, for four reasons that do not show up under light use:

1. **Ten database connections serve everything**, each request holds one for its whole life, and nothing times out. A burst, a slow vendor or one long admin operation queues every studio behind it.
2. **Mail is sent while a connection is held and before the response returns**, on a sender capped at 100 emails a day for all studios and staging together.
3. **Rate limits are per IP address**, so a studio's members on one wifi network share a single allowance.
4. **A few write paths are not race-safe**: a manual credit adjustment can lose a booking's debit, a workshop's last place can be sold twice, and a request that fails after writing can still commit.

The two auditors who looked at the pool disagreed on its severity (P0 from the database audit, P1 from the pipeline audit). This spec treats it as a launch blocker: it is the shared ceiling under most other P1 findings, and it has no timeout to turn a stall into an error.

No cross-tenant leak was found. Every in-process cache is keyed by Tenant and the Tenant context is transaction-local.

## 3. How the app behaves under load

### 3.1 One request

```
Browser ─► OPTIONS preflight (not cached) ─► API
Browser ─► request ─► requestId ─► logger ─► secureHeaders ─► CORS ─► maintenance gate (cached)
        ─► rate limiter (in memory, keyed before auth runs) ─► resolve Tenant (cached)
        ─► BEGIN ─► set_config(app.tenant_id) ─► auth: session, user, member-or-staff row
        ─► handler and its queries, any Stripe / R2 call included ─► COMMIT
        ─► after-commit work: one new transaction per email, held open across the Resend call
        ─► response
```

- Overhead before the handler: 3 round trips for a public request, 6 for a member or admin, 7 for an instructor, one more on a staff write for the audit row (PIPE-04).
- One pooled connection is held from `BEGIN` to `COMMIT`. After-commit mail then takes a connection again, one email at a time, behind a gate that starts at most 8 sends a second and retries up to 5 times with backoff up to 30 s (`lib/send-gate.ts:41-49`).
- The pool is `postgres(url)` with no options: 10 connections, no acquire timeout, no statement, lock or idle-in-transaction timeout. The three Better Auth pools, the cron jobs and both webhooks use the same 10.

### 3.2 What 100 members generate

- **Preflights:** every call carries `Authorization` and `X-Tenant-Slug`, so every call is preflighted, and the API sets no `Access-Control-Max-Age`. Backend hits are roughly double what the app needs (FEC-F1, PIPE-03).
- **Schedule page:** 12 reads on first load, 10 on each return, in a three-level waterfall (FEC-F3). The timetable read behind it is about 11–12 queries, unpaginated, 28 days by default (API-F08).
- **Every navigation:** `/me/packages` and `/me/approvals` re-fire (FEC-F2).
- **Polling:** `/me/approvals` every 60 s per member, about 100 requests a minute, 200 with preflights. It pauses in a hidden tab but has no backoff (FEC report, timer inventory).
- **My bookings:** the whole history in 7 unpaginated requests, re-read after every cancel (FEC-F4, API-F09).
- **Booking a class at release time:** race-safe, but about 17–20 sequential round trips under the class row lock; every member waiting on that lock holds a pooled connection, and there is no `lock_timeout` (API-F05). Each booking then sends its email as in §3.1.

### 3.3 What 10 staff generate

- About 1 request a minute per idle admin and about 11 a minute when navigating, roughly 110 a minute across ten (FEP report).
- The bell summary is polled every 60 s and on navigation and focus. Each call is about 31–41 uncached statements, two of them over the studio's whole payment history (A-01, A-03).
- The check-in desk rereads the whole day's rosters every 60 s, hidden tab or not (FEP-04).
- Finance fires a request per keystroke and downloads the whole ledger; the backend runs up to 17 sequential queries for it and sums in JS (FEP-01, C-02, C-04).
- Several admin actions are long single requests that hold a connection and locks the whole time: creating a Class Series (about 750–1,100 statements, B-03), cancelling a class (mails every attendee before answering, B-04), studio export and import (E-01, E-03).

### 3.4 Background work

Ten cron jobs run in the API process (`be/src/jobs/index.ts:167-175`); the full table is in the jobs report §(b). Up to eight start on the same quarter-hour tick, each taking a pooled connection per Tenant step (DB-05, J-06). None takes a lock or guards against overlapping its own previous run. Nine are idempotent; `sendLapsingAlerts` is not (J-02).

### 3.5 Where it breaks first

| Trigger | What happens | Findings |
|---|---|---|
| 30 members book one class as it opens | 30 requests queue on 10 connections; each then holds a connection again for its email at 8 sends a second; every other studio waits behind them | DB-01, DB-02, API-F01, API-F05 |
| Resend is slow or failing | Each email holds a connection through 5 attempts and up to 30 s backoff; the API stops answering | DB-02, M-02 |
| A class signs in by emailed code | The 100-a-day sender cap is spent; no code sign-in until 00:00 UTC | M-01, PIPE-06 |
| A studio's members share one wifi address | They share 300 authenticated and 100 public requests a minute, and 10 sign-ins a minute; 429s | S-01, PIPE-02, PIPE-12 |
| An admin runs a series create, class cancel, finance export or studio import | One connection and its locks held for the whole operation, with no timeout | B-03, B-04, C-02, E-01, E-03 |
| A deploy | Downtime while the single container is recreated; a second copy of the server runs every cron job against the live database for up to 40 s; policies are dropped and recreated table by table | S-02, J-01, DB-08 |
| The pool is full | `/health` waits on the same pool, so a busy server looks dead | DB-23, S-03 |

## 4. Root causes

Most findings trace back to eight decisions. Fixing these closes the bulk of the list.

| # | Root cause | What it produces |
|---|---|---|
| R1 | The pool is unconfigured and unobservable | DB-01, DB-06, DB-22, DB-23, PIPE-01, S-03 |
| R2 | Outbound calls (Resend, Stripe, R2, logo fetch) happen while a connection, and often a row lock, is held | DB-02, DB-03, M-02, M-03, O-01, W-01, API-F01–F03, API-F10, A-08, A-09, B-04, C-05, C-06, D-02, J-03 |
| R3 | The request transaction commits even when the handler threw | DB-04, C-13, API-F24 |
| R4 | Limits keyed on IP and held in process memory | S-01, PIPE-02, PIPE-12, API-F06, E-09, S-06, PIPE-10 |
| R5 | Lists have no page, no window and no cap; the browser filters | API-F08, API-F09, B-01, C-02, D-01, FEC-F4, FEP-05 and the rest of §5.3.1 |
| R6 | No read cache or cache headers on either side of the wire | API-F07, FEC-F2, FEC-F3, FEC-F8, FEP-10, A-01, PIPE-16 |
| R7 | Single-process assumptions with no guard | J-01, J-04, J-05, S-02, S-06, M-06, E-07, PIPE-10 |
| R8 | Read-then-write without a lock or a version on staff paths | C-01, D-04, DB-07, A-14, B-08, C-11, FEP-09 |

## 5. Fix plan

Work items are numbered `PR-nn`; item *n* of the published spec (issue #553) is `PR-nn` here, with the same findings. Each lists the findings it closes; §6 maps every finding back to an item. Evidence, file and line for each finding are in the report named by its prefix.

Phase 0 is what must land before the target load. Phases 1–4 are ordered by risk removed per unit of work, and items inside a phase are independent unless stated.

### 5.0 Phase 0 — launch blockers

**PR-01 Configure the pool and make it observable.** `be/src/db/index.ts`
- Pass explicit options to `postgres()`: `max` from a new env var sized against Postgres `max_connections` (staging and production share one Postgres host, so both pools plus the owner's migration connection must fit), `idle_timeout`, `max_lifetime`, `connect_timeout`, and `connection.application_name`.
- Set `statement_timeout`, `lock_timeout` and `idle_in_transaction_session_timeout` on the `booking_app` role or per connection. Long operations that legitimately exceed them (export, import) raise the limit locally with `SET LOCAL`.
- Bound the wait for a connection: a request that cannot get one within a few seconds answers 503 with `Retry-After` instead of queueing without limit.
- Log any `withTenant` that holds its connection longer than 1 s with route and Tenant, and emit pool in-use and waiting counts on an interval.
- `/health` races its `SELECT 1` against a 2 s timer and answers 503 `db: busy`.
- New env var: update `.github/workflows/deploy-be.yml`, `be/.env.example` and `be/src/env.ts` together.
- Closes: DB-01, DB-06, DB-22, DB-23, PIPE-01, S-03. Partly O-01, and the missing `lock_timeout` half of API-F05.

**PR-02 Move mail off the request path with an outbox.** `be/src/db/index.ts`, `services/notifications/send.ts`, `lib/send-gate.ts`, `lib/mailer.ts`
- A send becomes an `email_log` row written `queued` inside the request's own transaction. No Resend call, no second transaction, no awaited after-commit send.
- A worker in the API process claims queued rows with `FOR UPDATE SKIP LOCKED`, sends through the existing gate without holding a transaction across the call, and writes the outcome. Credential mail keeps its priority lane.
- Rows left `queued` or `sending` by a restart are picked up again; the idempotency key already on each send makes that safe.
- Because the queue is now the table, the pace survives a restart and a second instance does not double it.
- Replace the per-send cross-tenant count with a figure memoised for a minute, and add the index it needs (PR-34).
- Consequences that fall out: cancel class and cancel workshop answer immediately; `sendLapsingAlerts` and staff invitation mail stop sending inside a transaction.
- Closes: DB-02, M-02, M-03, M-04, M-06, API-F01, PIPE-05, B-04, D-02, A-09, J-03, DB-09 (the count), part of DB-20.

**PR-03 Decide the Resend plan before members arrive.** Not a code change first.
- The runbook already frames this as the open "Pro decision" (`email-deliverability-runbook.md:202`). At the target load the Free cap is spent by sign-in codes alone.
- Once on a paid plan, `DAILY_QUOTA` and `MONTHLY_QUOTA` in `lib/send-gate.ts` must match it, or the headroom warning fires on the wrong numbers.
- Staging should stop drawing on production's allowance (a separate Resend team or a sink address).
- Closes: M-01, PIPE-06.

**PR-04 Key rate limits on the caller.** `be/src/app.ts`, `services/auth/rate-limit.ts`
- Mount the authenticated limiter after auth has set `clientId` / `staffUserId`, or resolve the session's identity in the key generator, so the budget is per member or staff user.
- Keep a separate, larger per-IP ceiling as the flood guard, and take the client address from the proxy's trusted hop, not the raw `x-forwarded-for` string.
- Raise the public and sign-in budgets to fit a studio on one network, keyed where possible on IP plus email for sign-in.
- Give both webhook routes their own limiter and a body cap.
- Honour 429 and `Retry-After` in both frontends (PR-41, PR-49).
- Closes: S-01, PIPE-02, PIPE-12, API-F06, E-09, W-04.

**PR-05 Cache CORS preflights.** `be/src/app.ts:46-66`
- Add `maxAge` (for example 600 s; browsers cap it). Drop `credentials: true` if no cookie is used, which the pipeline audit suspects.
- Closes: FEC-F1, PIPE-03, PIPE-20.

**PR-06 Roll back the request transaction when the handler failed.** `be/src/middleware/tenant.ts`
- Hono catches a thrown error at the layer that threw it, so `next()` resolves and `withTenant` commits. Writes made outside a service's own savepoint before the throw are kept, and their after-commit work runs.
- After `next()`, if `c.error` is set (or the response is a 5xx), abort the transaction while keeping the response already built.
- Write the failing test first: a route that writes, then throws, must leave no row and send no mail.
- Then review the "reported, not thrown" catch blocks that swallow database errors inside the request transaction.
- Closes: DB-04, C-13, API-F24.

**PR-07 Lock the manual credit adjustment.** `services/packages/adjust.ts`
- `adjustBalance` and `setBalance` read the package without a lock and write an absolute balance. Take the same `FOR UPDATE` lock the booking path takes, inside the transaction, and compute `setBalance`'s delta after the lock.
- Test: a booking debit concurrent with an adjustment leaves a balance and a ledger that add up.
- Closes: C-01.

**PR-08 Stop workshops overselling.** `services/workshops/book.ts`, `services/billing/webhook-handler.ts`
- Lock the workshop (or its days) when checking capacity at checkout start, and re-check under the same lock when the place is granted, for paid and free bookings.
- Decide what a paid grant that finds the workshop full does: there is no automated refund today, so it must at least raise an attention item for staff.
- Make every workshop write route take the workshop lock the combined save relies on, and check capacity and existing sales when a day is edited or deleted.
- Closes: DB-07, API-F04, D-09, D-10.

**PR-09 Guard corporate scheduling.** `services/corporate/requests.ts`
- Lock the request row before scheduling, editing, cancelling or marking attended, and check its lifecycle under the lock.
- Closes: D-04, D-05, D-06.

**PR-10 Back the booking rules with unique indexes.**
- `bookings (class_id, client_id) WHERE state = 'confirmed' AND class_id IS NOT NULL`, and the workshop equivalent, after checking existing data and that ClassPass and staff overbooking never legitimately seat one member twice.
- Schema change: needs review by both backend developers.
- Closes: DB-16, API-F28.

**PR-11 Deploys must not run a second scheduler, and a failed scheduler must be loud.** `.github/workflows/deploy-be.yml`, `be/src/server.ts`, `be/src/jobs/index.ts`
- The smoke container starts the real server with the real env, so it registers every cron job against the live database. Start it with jobs disabled (an env flag read in `server.ts`).
- If `registerJobs()` fails, the process currently serves with no jobs and an empty feature-flag cache. Retry with backoff, report through `reportError`, and fail `/health` if registration never succeeds.
- Load feature flags before the server listens.
- Closes: J-01, J-04, PIPE-15. Partly PIPE-07.

**PR-12 Body limits and per-route timeouts.** `be/src/app.ts`, `be/src/server.ts`
- A global body limit of a few hundred kilobytes, with explicit larger limits on the upload routes only.
- The 60-minute `requestTimeout` exists for one route (the studio archive upload). Return the server default for everything else and apply the long timeout to that route alone.
- Closes: S-05, PIPE-08, E-05. Partly API-F20, O-01.

**PR-13 Make policy re-application safe on a live database.** `be/src/db/roles.ts`
- `ensureTenantIsolation` drops and recreates the policy on every table on every deploy, each statement autocommitted under an ACCESS EXCLUSIVE lock. Between the drop and the create the table is default-deny, so live reads return nothing.
- Read `pg_policies` first and touch only tables whose policy is missing or differs from the canonical text. When a change is needed, do the drop and create in one transaction with a `lock_timeout`.
- Take the opportunity to wrap the setting as `(select nullif(current_setting('app.tenant_id', true), '')::uuid)` so it is evaluated once per statement.
- Closes: DB-08, DB-14.

### 5.1 Phase 1 — vendor calls, idempotency, background work

**PR-14 Stripe calls outside the transaction and outside row locks.** `services/billing/*`, `services/packages/promo-redemption.ts`, `routes/client/purchases.ts`
- Checkout creation, `sync-session`, card listing and removal, refunds and `resumePurchaseCheckout`: read what is needed, commit, call Stripe, then write the result in a second short transaction.
- The promo code's `FOR UPDATE` lock must not span a Stripe call; reserve the redemption, release the lock, then call.
- `sync-session` currently holds two connections; it should hold none while calling Stripe.
- Move the Stripe logic out of `routes/client/purchases.ts` into `services/billing/`, per the repo convention.
- Route the Stripe key probe through the same `outbound` wrapper as every other vendor call.
- Closes: DB-03 (Stripe), API-F02, API-F03, API-F10, API-F25, C-05, W-03, O-06. Partly O-01.

**PR-15 Stripe webhook: acknowledge, then process.** `routes/webhooks/stripe.ts`, `services/billing/webhook-handler.ts`
- Verify the signature, record the event id in a table (unique), answer 200, and process from that record with the same worker pattern as PR-02.
- Fetch `latestCharge` once per intent, not twice.
- Use the logger, not `console.error`, for money owed.
- Closes: W-01, W-02, W-05, W-06.

**PR-16 R2 and logo fetches outside the transaction; resize uploads.** `services/profile-pictures/*`, `routes/uploaded-file.ts`, `services/receipts/*`
- Upload to R2 before or after the transaction, never inside it.
- Resize and re-encode avatars and other uploads on the way in (a few hundred pixels for avatars), instead of storing up to 5 MB originals.
- Cache the studio logo bytes used by Receipt PDFs in process with a short TTL, instead of re-fetching and inflating them per render. Check the logo fetch for server-side request forgery while there (noted by the jobs audit as a cross-slice item).
- Receipt reads: project only the fields a summary needs and stop returning the rendered HTML twice.
- Closes: DB-03 (R2, logo), A-08, C-06, API-F16, API-F22, O-03, O-04.

**PR-17 Idempotent writes.** member and staff write endpoints, both API clients
- Accept an `Idempotency-Key` on checkout creation, class booking, PT request, refunds, series create and PT scheduling; store it with the result and replay on a repeat. Both frontends send one per user action.
- Pass an idempotency key to Stripe on session creation.
- Retry `bookClass` on deadlock through `retryingTransaction`, and map a booking-code collision and the trial unique-index violation to their proper conflict codes instead of a 500.
- Cap the PT request `slots` array.
- Closes: API-F11, API-F12, API-F13, API-F30, FEP-03. The idempotency part of FEC-F21.

**PR-18 Cron jobs: lock, do not overlap, stagger, catch up.** `be/src/jobs/index.ts` and each job's service
- Wrap each job in a Postgres advisory lock so a second process, or a slow previous run, skips rather than doubles.
- Offset the jobs that share the quarter-hour tick so they do not take eight connections at once.
- `sendLapsingAlerts`: record what was sent (a marker column or a claim statement, as `sendCheckInNags` already does), so a second run sends nothing and a missed 08:00 run is caught up.
- Daily jobs: run on the first tick at or after their hour if the day's run has not happened.
- Bound `expireStaleSessions` with a `LIMIT` per run; restrict `expireWaitlists` to recently started classes; stop `pruneStaffUpdates` returning every deleted id; correct the timezone comment the jobs audit found wrong.
- Closes: J-02, J-05, J-06, J-07, J-08, J-09, J-10, J-11, DB-05.

**PR-19 Studio export and import out of the request path.** `services/tenants/transfer.ts`, `services/tenants/import-jobs.ts`, `routes/platform/transfer.ts`
- Stream the archive to and from R2 instead of buffering up to 1 GiB twice in the API process; build and parse it in a worker thread or a separate one-off process.
- Require the studio to be suspended before a replace-import, and write in batches rather than one transaction over every row.
- Create logins in batches, not one member at a time.
- Persist the import request on the job row instead of a process-local `Map`.
- `GET /platform/imports` should be one read, not a transaction per Tenant with writes.
- Member export: one consistent snapshot, streamed.
- Closes: E-01, E-02, E-03, E-04, E-06, E-07, O-05, C-14.

**PR-20 Graceful shutdown and zero-downtime deploys.** `be/src/server.ts`, `deploy-be.yml`
- On SIGTERM: stop cron, stop accepting connections, drain requests, let the outbox worker finish its current send, close the pool. Match the forced-exit timer to Docker's `stop_grace_period`.
- Start the new container beside the old one and switch the proxy once it is healthy, instead of recreating in place. This needs PR-18's locks first.
- Treat an unhandled rejection as a reported error, and decide deliberately whether to exit.
- Closes: S-02, S-08, DB-20, PIPE-07.

**PR-21 Guard nested Tenant contexts.** `be/src/db/index.ts`
- `withTenant` inside an open scope for the same Tenant reuses it; for a different Tenant it throws. No call site does this today; the guard prevents a future pool self-deadlock.
- Closes: DB-19.

### 5.2 Phase 2 — the request pipeline

**PR-22 Cut identity overhead.** `services/auth/better-auth.ts`, `middleware/client-auth.ts`, `middleware/staff-auth.ts`
- Session, user and member-or-staff row are three queries that return the same thing on every call. Read them in one joined query (Better Auth's `advanced.database.joins`, or a hand-written join), or cache the resolved identity in process for a few seconds keyed by session token and Tenant.
- `requireActiveTenant` should use the Tenant row the resolver already holds.
- Send `BEGIN` and `set_config` as one pipelined batch only if profiling after PR-01 says it matters.
- Closes: PIPE-04, PIPE-18, DB-21.

**PR-23 Cache what is static per Tenant, on both sides.** member and public catalogue routes
- `Cache-Control` and `ETag` on public catalogue, timetable shell, branding, policy and marketing reads; short private caching on member reads that tolerate it.
- Read the cancellation-policy row once per request.
- Negative-cache unknown slugs briefly.
- Response compression in the app, or confirm the proxy does it (§8).
- CDN proxy: add `s-maxage` so the edge caches, and a timeout on the upstream fetch. Confirm with `x-vercel-cache` on a repeat request.
- Closes: API-F07, API-F27, PIPE-16, S-04, O-02.

**PR-24 Password hashing off the hot path.** `services/auth/*`
- Verify passwords outside the Tenant transaction. Move legacy bcrypt verification off the event loop and rehash to the current scheme on a successful sign-in.
- Closes: PIPE-11.

### 5.3 Phase 2 — bounded reads, fewer statements

**PR-25 Paginate or window every list.** *(§5.3.1)*
- Rule: every list endpoint takes a cursor or a required date window, has a server-side maximum page size, and orders deterministically. Filtering, sorting and search move to SQL.
- Member side: class timetable (required window, a cap well under 90 days, location and instructor data sent once rather than on every card); past and cancelled bookings, PT requests, workshop bookings, merch orders, corporate requests, packages, credit history.
- Staff side: timetable (required window and a cap), admin PT queue, instructor payroll (required range), leave lists and leave calendar span, finance list and CSV, receipts CSV, corporate session and request lists, workshops list (no description HTML in the list), ClassPass review queue (no email bodies in the list).
- Each needs its frontend half: PR-40 and PR-46.
- Closes: API-F08, API-F09, B-01, D-01, A-07, A-10, A-11, A-12, C-02, C-07, D-03, D-07, D-12.

**PR-26 Finance in SQL.** `services/finance/*`
- Aggregate the overview in the database instead of running the full ledger read and summing in JS; do not run it twice per page.
- Neutralise spreadsheet formulas in every CSV export (prefix cells starting with `=`, `+`, `-`, `@`).
- Closes: C-04, C-10. With PR-25: C-02.

**PR-27 Make the bell cheap.** `services/attention/*`
- Compute the summary once per Tenant and cache it for the polling interval, invalidated by the writes that change it; or maintain counters.
- Stop running the six workspace counts twice, stop aggregating the whole payment history for refund counts, and let the panel reuse the summary's counts and page its lists in SQL.
- Replace the two regex and expression scans with indexed predicates.
- Closes: A-01, A-02, A-03, A-04, A-05.

**PR-28 Remove N+1 and long single requests on staff paths.**
- `GET /portal/admin/staff`: one set-based read; no row locks and no inserts in a GET (create leave pools when staff are created, or in a job).
- Class Series preview and commit: batch the conflict checks and inserts; do not repeat the preview's work on commit. Ending a series: one set-based cancel.
- Cancel class: set-based writes instead of three statements per booking under the locks.
- Class detail: one query for waiting members' packages, no savepoint around a read.
- Workshop save: batch per-day and per-tier statements.
- Timetable: fewer sequential queries, a window predicate the `starts_at` index can serve, waiting counts by `COUNT` rather than fetching rows.
- Check-in day: one indexable roster query, grouping in SQL.
- Member detail: about 25 statements with repeats; fetch each thing once and split the monolithic payload (PR-47). Trial funnel: compute once, not per page.
- ClassPass: no writes on `GET`; stop recomputing whole-history aggregates; do not re-place every waiting email in one request.
- Create and patch should return from `RETURNING`; the instructor roster should check ownership before building the full detail; PT edit and platform routes have redundant reads and sequential awaits.
- Closes: A-06, A-17, B-02, B-03, B-05, B-06, B-07, B-12, B-13, B-15, B-16, C-08, C-09, D-08, D-11, D-15, E-08.

**PR-29 Trim the member read and write paths.**
- Booking a class: shorten the 17–20 round trips under the class lock (fetch policy, package and class in fewer statements; do nothing under the lock that can be done before it).
- Cancel: run waitlist promotion after the canceller's transaction, not inside it under the class lock.
- Promo validation: count redemptions, do not load every row.
- Attendance summary: aggregate in SQL, or keep a counter, instead of rescanning the member's whole history.
- Remove repeated lookups, sequential awaits that can be one query, and over-fetched columns listed in the report.
- Fix the two read bugs found on the way: `GET /me/classes/:id` always returns a null `waitlist.my_entry`, and the workshop detail does not filter on lifecycle.
- Remove the two stub referral endpoints that answer 501 in production.
- Closes: API-F05, API-F14, API-F15, API-F17, API-F18, API-F19, API-F26, API-F29.

**PR-30 Search that can use an index.** `services/clients/manage.ts`, `services/receipts/read.ts`, PT partner lookup
- Minimum query length of 2–3 characters, run the search once per request, select only the columns shown.
- `pg_trgm` GIN indexes on member name, email and phone if `EXPLAIN` as `booking_app` confirms the scan. Plans must be read as `booking_app`: the owner bypasses RLS and plans differently.
- A dedicated typeahead endpoint for the member picker, returning id and label only.
- Partner lookup: rate-limit it per member (it is a member-directory oracle) and index the predicate it uses.
- Closes: C-03, B-11, DB-15, API-F23, D-14, FEP-15.

**PR-31 New narrow endpoints the frontends need.**
- "Next booking" for the member app's Up-next card, instead of four full lists.
- A single catalogue item by id for checkout and confirmation, instead of the whole catalogue.
- Closes the backend half of FEC-F6 and FEC-F9.

**PR-32 Input bounds.** zod schemas across routes
- Maximum lengths on strings, caps on arrays and numbers, UUID validation on every path id, page-size and date-range caps.
- A class edit must not drop buffer or waitlist capacity below what is already used.
- Closes: A-16, B-09, B-10, C-12, D-13, API-F20, API-F21.

**PR-33 Optimistic concurrency on staff edits.**
- Carry a version (or `updated_at`) on edited entities and refuse a save made against a stale one with a 409 the UI can explain. Applies to class, series, catalogue, PT, corporate, policy, location, pay and settings edits.
- Leave conflicts: replace delete-all-and-insert with a diff, and stop locking every instructor row to save them.
- Catalogue writes and member creation: enforce with a constraint and map the violation, instead of check-then-write. Archive blockers should return a count, not every row.
- Policy save: one request, not two PATCHes that can half-succeed.
- Closes: A-13, A-14, B-08, B-14, C-11, C-15, FEP-09, FEP-26.

### 5.4 Phase 2 — schema

All of this is schema change and goes through review by both backend developers.

**PR-34 Missing indexes.**
- `email_log (sent_at) WHERE sent_at IS NOT NULL`.
- `email_log (tenant_id, smtp_message_id) WHERE smtp_message_id IS NOT NULL`.
- `stripe_payments (payment_intent_id)`.
- `bookings (tenant_id, booked_at)`, `client_packages (tenant_id, purchased_at)`, `stripe_payments (tenant_id, created_at)`, `receipts (tenant_id, issued_at DESC, number DESC)`, `merch_orders (tenant_id, created_at)`.
- `client_packages (client_id)` and `promo_code_redemptions (promo_code_id)`, which today are covered only by partial indexes.
- `(expires_at)` on the three auth session tables, for PR-36's sweep.
- Closes: DB-09 (index), DB-10, DB-11, DB-12.

**PR-35 Remove redundant indexes, after measuring.**
- `bookings` carries 18 indexes, `classes` 15, `pt_requests` 14, `client_packages` 12; many are a single-column foreign-key index beside a `(tenant_id, fk, …)` composite. After two weeks of production traffic, read `pg_stat_user_indexes` and drop the half of each pair with `idx_scan = 0`.
- Minor schema notes from DB-24: two unique indexes that do not lead with `tenant_id` (correct, inconsistent), bare `(tenant_id)` indexes on small tables, an index on `tenants.status`, and currency baked into `*_sgd` column names on a multi-tenant platform. Record a decision on each; none is urgent.
- Closes: DB-17, DB-24.

**PR-36 Retention.** a daily platform job and a written retention table
- `email_log`: null the rendered body after about 90 days, delete after about 13 months.
- Expired auth sessions and verification rows: delete after 7 days.
- `auth_events`: about 13 months. `classpass_inbound_emails` raw bodies: 90 days after resolution.
- `audit_log`: state explicitly whether it is kept forever.
- The periods are a product and privacy decision; `member-data-retention.md` is the place to record them.
- Closes: DB-13, PIPE-13.

**PR-37 Migrations that do not block a live table.** `be/src/db/migrate.ts`
- `lock_timeout` on the migration connection, so a migration fails and is retried instead of queueing every query on a table behind itself.
- A documented path for building an index on a large table with `CREATE INDEX CONCURRENTLY` outside the migration transaction.
- Closes: DB-18.

### 5.5 Phase 3 — member app (`fe-client/`)

**PR-38 One read cache with a stale time.** `fe-client/lib/resource-cache.ts` and the hooks
- Give the cache a stale time so a return to a page does not revalidate everything; route the six hooks that bypass it through it; one cache key per resource (`/me/class-packages` is fetched twice under two keys, for data `/me/packages` already returns).
- Stop re-reading `/me/packages` and `/me/approvals` on every pathname change.
- Abort in-flight reads on unmount and key change.
- Closes: FEC-F2, FEC-F7, FEC-F8, FEC-F12.

**PR-39 Flatten the schedule page.** `fe-client` class feed
- Parallelise the three-level waterfall and drop reads the page already has; do not read `/me/classes/:id` twice on the book path; a row cancel updates the cache instead of re-reading the upcoming list.
- Render only the visible days, and load dialogs with `next/dynamic` instead of mounting ten days of rows each with about 17 state hooks.
- Closes: FEC-F3, FEC-F10, FEC-F15.

**PR-40 Paged history and narrow reads.** needs PR-25 and PR-31
- My bookings: paged, and a cancel updates one row instead of re-reading seven lists. Opening one practice day reads that day.
- Up next: the new endpoint.
- Checkout and confirmation: the single-item endpoint; read instructors only when shown.
- Closes: FEC-F4, FEC-F6, FEC-F9.

**PR-41 Degrade gracefully.** `fe-client/lib/failed-read.ts`, `api.ts`
- One failed non-critical read should fail its own section, not the route. Handle 429 and 503 with `Retry-After`. "Try again" retries what failed.
- Polls: backoff with jitter on error. The maintenance recheck pauses when hidden and staggers the reload on recovery.
- Closes: FEC-F5, FEC-F20.

**PR-42 Rendering and assets.**
- Make the shell static or cached per studio: the `cookies()` read for the impersonation banner forces every route dynamic.
- `next/image` (or sized, lazy `<img>`) for avatars and merch; host the sign-in hero instead of hot-linking it; remove placeholder image hosts from the production config.
- Closes: FEC-F11, FEC-F13, FEC-F14.

**PR-43 Lint and small fixes.**
- Add an ESLint config so `next lint` and the hooks rules actually run.
- Partner lookup: one request per check with an in-flight guard. Debounce receipt date filters. Clear the profile "saved" timer.
- The smaller items listed under F21 in the report, including Better Auth's session refetch on every tab focus.
- Closes: FEC-F16, FEC-F17, FEC-F18, FEC-F19, FEC-F21.

### 5.6 Phase 3 — staff app (`fe-portal/`)

**PR-44 A shared read cache and request discipline.** `fe-portal/lib`
- One cache with a stale time, used by every page; identical reads stop repeating on every mount.
- Abort superseded requests (stepping weeks on the calendar leaves every earlier query running on the backend) and guard against a stale answer painting over a newer one.
- Debounce every search box.
- Stop revalidating the session on every window focus.
- Closes: FEP-07, FEP-10, FEP-14.

**PR-45 One polling helper.**
- Pauses when the tab is hidden, backs off with jitter on error, honours `Retry-After`, sends one request on tab return rather than two.
- Use it for attention, check-in, ClassPass setup, the platform import poll and the maintenance recheck. The check-in desk should fetch changes, not the whole day, after a scan.
- Closes: FEP-04, FEP-28.

**PR-46 Server-side lists.** needs PR-25, PR-26, PR-30
- Finance, admin leave, PT sessions, instructor PT queue and corporate requests page and filter on the server. A pay-cell save updates its row instead of refetching the ledger and the analytics overview.
- The member typeahead uses the dedicated endpoint.
- Closes: FEP-01, FEP-05, FEP-15.

**PR-47 Stop reloading whole pages after an action.**
- Admin class detail: update in place after a roster, waitlist or save action, as the instructor page already does; keep unsaved editor state.
- Customer profile: split the monolithic read into sections that load and refresh independently, with capped lists.
- Closes: FEP-02, FEP-06.

**PR-48 Rendering, bundle and duplication.**
- Disable or defer `<Link>` prefetch on calendar events and list rows; confirm the request count in a production network tab first.
- Memoise the `WorkspaceContext` value and the calendar's cells.
- `next/dynamic` for dialogs and editors; load the phone-input library only where used.
- Collapse the hard-load waterfall and the triple Tenant lookup; decide which routes can be static.
- Fold the code duplicated between the admin and instructor surfaces into shared components.
- Sized, lazy images. Remove dead code (`switchStaff`, `updateStaffGrants`, `allStaff`, `DevRoleSwitcher`) and the `any` cast on the workshop read.
- Closes: FEP-08, FEP-11, FEP-12, FEP-13, FEP-17, FEP-18, FEP-19, FEP-23, FEP-24, FEP-25.

**PR-49 Resilience and safety.**
- Handle 401, 429 and 503 centrally. Downloads go through the API client so they get the same auth, timeout and error handling.
- Tighten the Content-Security-Policy: it allows inline script while the session token sits in `localStorage`.
- The now-line and "today" must tick on a tab left open overnight. Stop the QR camera and decode loop when hidden. `reportError` should not `console.error` every failed poll in production.
- Closes: FEP-16, FEP-20, FEP-21, FEP-22, FEP-27.

### 5.7 Phase 4 — hardening and hygiene

**PR-50 Production image.** `be/Dockerfile`
- Compile to JavaScript and run `node`, as a non-root user, from an image without dev dependencies.
- Closes: S-07, PIPE-09.

**PR-51 Prepare for a second instance.**
- Feature flags: read with the same 60 s TTL as the other caches and write the cache in `afterCommit` (this is wrong today with one instance, for a restored studio).
- Rate limiters and auth budgets: move to Postgres or Redis before a second instance exists.
- Cache invalidation across instances for Tenant, credential and mail-identity caches; evict Stripe clients for rotated keys; bound the platform set-password cooldown map.
- Closes: S-06, PIPE-10, A-15.

**PR-52 Logs and small server items.**
- Keep recipient addresses and studio slugs out of shipped logs, per the runbook's ids-only rule.
- Fix the access-log skip list so the liveness probe is not logged; validate a client-supplied `x-request-id`; stop `GET /` naming the service; skip `secureHeaders` and CORS on webhook and health routes; check synchronous stdout logging under load.
- Resend webhook: read its secret from `env.ts` and build its client lazily.
- Stripe SDK: plan the upgrade from 14.25 and API version `2023-10-16`.
- Closes: M-05, PIPE-14, PIPE-17, S-09, PIPE-19, PIPE-21, S-10, S-11, W-07, O-07.

## 6. Findings register

Every finding in the seven reports, and the work item that closes it.

### Database (`audit-1-db.md`)

| Finding | Sev | Item | Finding | Sev | Item |
|---|---|---|---|---|---|
| DB-01 pool of 10, held per request | P0 | PR-01 | DB-13 no retention | P2 | PR-36 |
| DB-02 mail holds a connection | P0 | PR-02 | DB-14 policy not an initplan | P2 | PR-13 |
| DB-03 vendor calls in transaction | P1 | PR-14, PR-16 | DB-15 RLS and non-leakproof predicates | P2 | PR-30 |
| DB-04 throw does not roll back | P1 | PR-06 | DB-16 no unique index for double booking | P2 | PR-10 |
| DB-05 eight jobs on one tick | P1 | PR-18 | DB-17 index bloat | P2 | PR-35 |
| DB-06 no timeouts | P1 | PR-01 | DB-18 non-concurrent migrations | P2 | PR-37 |
| DB-07 workshop capacity unlocked | P1 | PR-08 | DB-19 nested `withTenant` | P2 | PR-21 |
| DB-08 policies rewritten each deploy | P1 | PR-13 | DB-20 abrupt shutdown | P2 | PR-20, PR-02 |
| DB-09 `email_log` count scan | P2 | PR-02, PR-34 | DB-21 extra round trips for the GUC | P3 | PR-22 |
| DB-10 `smtp_message_id` unindexed | P2 | PR-34 | DB-22 pool not observable | P3 | PR-01 |
| DB-11 refund routing scan | P2 | PR-34 | DB-23 `/health` shares the pool | P3 | PR-01 |
| DB-12 finance date indexes | P2 | PR-34 | DB-24 minor schema notes | P3 | PR-35 |

### Mail, jobs, webhooks, outbound, server (`audit-2-jobs-integrations-server.md`)

| Finding | Sev | Item | Finding | Sev | Item |
|---|---|---|---|---|---|
| M-01 Resend Free cap | P0 | PR-03 | W-04 webhook limit and body cap | P2 | PR-04 |
| M-02 response waits on mail | P1 | PR-02 | W-05 event ids not recorded | P2 | PR-15 |
| M-03 in-memory queue lost on restart | P1 | PR-02 | W-06 `console.error` for money | P3 | PR-15 |
| M-04 count query per email | P2 | PR-02 | W-07 Resend webhook secret | P3 | PR-52 |
| M-05 recipient addresses in logs | P2 | PR-52 | O-01 connection held for whole request | P1 | PR-01, PR-12, PR-14 |
| M-06 second instance doubles pace | P3 | PR-02 | O-02 CDN not edge-cached | P1 | PR-23 |
| J-01 deploy boots second scheduler | P1 | PR-11 | O-03 uploads stored unresized | P2 | PR-16 |
| J-02 lapsing alerts have no marker | P1 | PR-18 | O-04 logo refetched per PDF | P2 | PR-16 |
| J-03 lapsing alerts send in transaction | P1 | PR-02 | O-05 archive buffered in memory | P2 | PR-19 |
| J-04 failed job registration is silent | P1 | PR-11 | O-06 key probe skips `outbound` | P3 | PR-14 |
| J-05 no overlap protection | P2 | PR-18 | O-07 Stripe SDK version | P3 | PR-52 |
| J-06 eight jobs per tick | P2 | PR-18 | S-01 limiter keyed on IP | P1 | PR-04 |
| J-07 no catch-up | P2 | PR-18 | S-02 deploy downtime | P1 | PR-20 |
| J-08 timezone claim wrong | P3 | PR-18 | S-03 pool exhaustion fails `/health` | P1 | PR-01 |
| J-09 `expireStaleSessions` N+1 | P3 | PR-18 | S-04 no compression | P2 | PR-23 |
| J-10 `expireWaitlists` rescans | P3 | PR-18 | S-05 no body limit or route timeout | P2 | PR-12 |
| J-11 prune returns every id | P3 | PR-18 | S-06 process-local state | P2 | PR-51 |
| W-01 webhook works before 200 | P1 | PR-15 | S-07 `tsx` as root | P2 | PR-50 |
| W-02 charge fetched twice | P2 | PR-15 | S-08 unhandled rejection ignored | P2 | PR-20 |
| W-03 `sync-session` two connections | P2 | PR-14 | S-09 access-log skip path | P3 | PR-52 |
| | | | S-10 synchronous logging | P3 | PR-52 |
| | | | S-11 headers on webhook routes | P3 | PR-52 |

### Member and public API (`audit-3-member-api.md`)

| Finding | Sev | Item | Finding | Sev | Item |
|---|---|---|---|---|---|
| API-F01 mail awaited in request | P0 | PR-02 | API-F16 receipts over-fetch | P2 | PR-16 |
| API-F02 Stripe in transaction | P1 | PR-14 | API-F17 repeated lookups | P2 | PR-29 |
| API-F03 promo lock across Stripe | P1 | PR-14 | API-F18 over-fetching | P2 | PR-29 |
| API-F04 workshop oversell | P1 | PR-08 | API-F19 attendance rescans history | P2 | PR-29 |
| API-F05 booking critical section | P1 | PR-29, PR-01 | API-F20 body limit, string caps | P2 | PR-12, PR-32 |
| API-F06 limits keyed on IP | P1 | PR-04 | API-F21 path ids not validated | P2 | PR-32 |
| API-F07 no cache headers | P1 | PR-23 | API-F22 avatars unresized, R2 in transaction | P2 | PR-16 |
| API-F08 timetable unpaginated | P1 | PR-25 | API-F23 partner lookup oracle | P2 | PR-30 |
| API-F09 history lists unbounded | P1 | PR-25 | API-F24 swallowed database errors | P3 | PR-06 |
| API-F10 purchase lock across Stripe | P1 | PR-14 | API-F25 logic in a route file | P3 | PR-14 |
| API-F11 checkout not idempotent | P2 | PR-17 | API-F26 two read bugs | P3 | PR-29 |
| API-F12 PT request no dedupe | P2 | PR-17 | API-F27 unknown slugs not cached | P3 | PR-23 |
| API-F13 no deadlock retry on booking | P2 | PR-17 | API-F28 no booking unique index | P3 | PR-10 |
| API-F14 promotion inside cancel | P2 | PR-29 | API-F29 stub endpoints | P3 | PR-29 |
| API-F15 promo loads every redemption | P2 | PR-29 | API-F30 trial race returns 500 | P3 | PR-17 |

### Staff and super-portal API (`audit-4-portal-api.md`)

| Finding | Sev | Item | Finding | Sev | Item |
|---|---|---|---|---|---|
| A-01 bell summary cost | P1 | PR-27 | C-05 Stripe in transaction | P1 | PR-14 |
| A-02 counts run twice | P2 | PR-27 | C-06 mail, R2, logo inline | P2 | PR-16 |
| A-03 refund counts over whole history | P1 | PR-27 | C-07 receipts CSV unbounded | P2 | PR-25 |
| A-04 unindexed polled counts | P2 | PR-27 | C-08 member detail ~25 statements | P2 | PR-28 |
| A-05 panel recounts | P2 | PR-27 | C-09 trial funnel recomputed | P2 | PR-28 |
| A-06 staff list N+1, writes in a read | P1 | PR-28 | C-10 CSV formula injection | P2 | PR-26 |
| A-07 instructor payroll unbounded | P2 | PR-25 | C-11 last write wins | P2 | PR-33 |
| A-08 R2 PUT in transaction | P1 | PR-16 | C-12 missing bounds | P3 | PR-32 |
| A-09 staff mail in transaction | P1 | PR-02 | C-13 swallowed errors in transaction | P3 | PR-06 |
| A-10 leave lists unbounded | P2 | PR-25 | C-14 member export | P3 | PR-19 |
| A-11 leave calendar span | P3 | PR-25 | C-15 member create race | P3 | PR-33 |
| A-12 leave `year` | P3 | PR-25 | D-01 PT queue unbounded | P1 | PR-25 |
| A-13 leave conflicts lock all instructors | P3 | PR-33 | D-02 workshop cancel mail | P1 | PR-02 |
| A-14 no optimistic concurrency | P2 | PR-33 | D-03 corporate lists unbounded | P2 | PR-25 |
| A-15 flag cache before commit | P3 | PR-51 | D-04 corporate double schedule | P1 | PR-09 |
| A-16 missing bounds | P3 | PR-32 | D-05 corporate edit unlocked | P2 | PR-09 |
| A-17 small redundancies | P3 | PR-28 | D-06 corporate cancel unguarded | P3 | PR-09 |
| B-01 timetable no cap | P1 | PR-25 | D-07 workshop list | P2 | PR-25 |
| B-02 timetable 12 queries | P2 | PR-28 | D-08 workshop save statements | P1 | PR-28 |
| B-03 series ~1,000 statements | P1 | PR-28 | D-09 workshop routes skip lock | P2 | PR-08 |
| B-04 cancel class mails serially | P1 | PR-02 | D-10 workshop capacity | P1 | PR-08 |
| B-05 cancel class per-booking writes | P2 | PR-28 | D-11 ClassPass writes on read | P2 | PR-28 |
| B-06 class detail N+1 | P2 | PR-28 | D-12 ClassPass review queue | P2 | PR-25 |
| B-07 end series one by one | P1 | PR-28 | D-13 missing bounds | P2 | PR-32 |
| B-08 no optimistic concurrency | P2 | PR-33 | D-14 partner lookup index | P3 | PR-30 |
| B-09 capacity below used | P3 | PR-32 | D-15 PT edit redundant reads | P3 | PR-28 |
| B-10 unbounded bodies | P2 | PR-32 | E-01 export/import in API process | P1 | PR-19 |
| B-11 instructor member search | P2 | PR-30 | E-02 export holds a connection | P2 | PR-19 |
| B-12 check-in day query | P3 | PR-28 | E-03 replace-import on a live studio | P1 | PR-19 |
| B-13 waiting counts fetch rows | P3 | PR-28 | E-04 import logins N+1 | P2 | PR-19 |
| B-14 catalogue writes unlocked | P3 | PR-33 | E-05 import body unbounded | P2 | PR-12 |
| B-15 re-read after write | P3 | PR-28 | E-06 `GET /platform/imports` | P2 | PR-19 |
| B-16 roster before ownership check | P3 | PR-28 | E-07 import state in a `Map` | P2 | PR-19 |
| C-01 credit adjust race | P1 | PR-07 | E-08 platform route nits | P3 | PR-28 |
| C-02 finance unbounded | P1 | PR-25, PR-26 | E-09 limiter before auth | P1 | PR-04 |
| C-03 search ILIKE | P1 | PR-30 | | | |
| C-04 overview full read | P1 | PR-26 | | | |

### Member app (`audit-5-fe-client.md`)

| Finding | Sev | Item | Finding | Sev | Item |
|---|---|---|---|---|---|
| FEC-F1 preflights | P1 | PR-05 | FEC-F12 no aborts | P2 | PR-38 |
| FEC-F2 reads on every navigation | P1 | PR-38 | FEC-F13 raw images | P2 | PR-42 |
| FEC-F3 schedule fan-out | P1 | PR-39 | FEC-F14 hot-linked hero | P2 | PR-42 |
| FEC-F4 bookings unpaginated | P1 | PR-40 | FEC-F15 ten days mounted | P2 | PR-39 |
| FEC-F5 one failure blanks the page | P1 | PR-41 | FEC-F16 no ESLint config | P2 | PR-43 |
| FEC-F6 Up next over-fetch | P1 | PR-40, PR-31 | FEC-F17 partner lookup twice | P3 | PR-43 |
| FEC-F7 class packages twice | P2 | PR-38 | FEC-F18 receipt filter debounce | P3 | PR-43 |
| FEC-F8 hooks bypass cache | P2 | PR-38 | FEC-F19 timer not cleared | P3 | PR-43 |
| FEC-F9 whole catalogue for one item | P2 | PR-40, PR-31 | FEC-F20 maintenance recheck | P3 | PR-41 |
| FEC-F10 class read twice | P2 | PR-39 | FEC-F21 smaller items | P3 | PR-43, PR-17 |
| FEC-F11 all routes dynamic | P2 | PR-42 | | | |

### Staff app (`audit-6-fe-portal.md`)

| Finding | Sev | Item | Finding | Sev | Item |
|---|---|---|---|---|---|
| FEP-01 finance per keystroke | P1 | PR-46 | FEP-15 typeahead on full list | P2 | PR-46, PR-30 |
| FEP-02 class detail refetch | P1 | PR-47 | FEP-16 downloads bypass client | P2 | PR-49 |
| FEP-03 no idempotency key | P1 | PR-17 | FEP-17 duplicated surfaces | P2 | PR-48 |
| FEP-04 polls without backoff | P1 | PR-45 | FEP-18 hard-load waterfall | P2 | PR-48 |
| FEP-05 whole-table lists | P1 | PR-46 | FEP-19 all routes dynamic | P2 | PR-48 |
| FEP-06 monolithic customer profile | P1 | PR-47 | FEP-20 CSP and `localStorage` | P2 | PR-49 |
| FEP-07 stale reads, no aborts | P1 | PR-44 | FEP-21 now-line overnight | P3 | PR-49 |
| FEP-08 link prefetch | P1 | PR-48 | FEP-22 QR loop when hidden | P3 | PR-49 |
| FEP-09 concurrent edits | P1 | PR-33 | FEP-23 raw images | P3 | PR-48 |
| FEP-10 no shared cache | P2 | PR-44 | FEP-24 dead code | P3 | PR-48 |
| FEP-11 context rebuilt | P2 | PR-48 | FEP-25 `any` cast | P3 | PR-48 |
| FEP-12 calendar memoisation | P2 | PR-48 | FEP-26 policy double PATCH | P3 | PR-33 |
| FEP-13 no code-splitting | P2 | PR-48 | FEP-27 `console.error` per poll | P3 | PR-49 |
| FEP-14 session on focus | P2 | PR-44 | FEP-28 polls when hidden | P3 | PR-45 |

### Pipeline, auth, deployment (`audit-7-auth-pipeline-deploy.md`)

| Finding | Sev | Item | Finding | Sev | Item |
|---|---|---|---|---|---|
| PIPE-01 pool of 10 | P1 | PR-01 | PIPE-12 sign-in budgets per IP | P2 | PR-04 |
| PIPE-02 limiter keyed on IP | P1 | PR-04 | PIPE-13 nothing pruned | P2 | PR-36 |
| PIPE-03 no CORS max-age | P1 | PR-05 | PIPE-14 slugs in logs | P2 | PR-52 |
| PIPE-04 identity lookups | P1 | PR-22 | PIPE-15 flags loaded after listen | P2 | PR-11 |
| PIPE-05 response waits on mail | P1 | PR-02 | PIPE-16 no compression or ETag | P2 | PR-23 |
| PIPE-06 Free-plan quota | P1 | PR-03 | PIPE-17 liveness probe logged | P3 | PR-52 |
| PIPE-07 deploys not zero-downtime | P1 | PR-11, PR-20 | PIPE-18 Tenant row re-read | P3 | PR-22 |
| PIPE-08 body limit, 60-min timeout | P1 | PR-12 | PIPE-19 request id trusted | P3 | PR-52 |
| PIPE-09 `tsx` as root | P2 | PR-50 | PIPE-20 CORS credentials | P3 | PR-05 |
| PIPE-10 process-local state | P2 | PR-51 | PIPE-21 `GET /` names the service | P3 | PR-52 |
| PIPE-11 password hashing in transaction | P2 | PR-24 | | | |

## 7. Measurements still owed

The audits read code. These turn SUSPECTED into known, and prove each phase worked.

1. **A load test at the target shape**, against staging with production-sized seed data: 100 virtual members (browse the schedule, open a class, book, cancel, view bookings; 30 of them booking one class in the same second) and 10 staff (calendar week-stepping, class detail, check-in desk open, finance, one Class Series create, one class cancel). Record p50/p95/p99 latency, error rate, pool in-use and waiting, and Postgres `pg_stat_activity`. Run it before Phase 0 for a baseline and after each phase.
2. **The same test with Resend made slow**, to prove PR-02 took mail off the request path.
3. **`EXPLAIN (ANALYZE, BUFFERS)` as `booking_app`** for the timetable, finance list, receipts list, member search, attention summary and the Resend webhook lookup. Plans read as the owner are not evidence: the owner bypasses RLS.
4. **`pg_stat_user_indexes` after two weeks of production traffic**, for PR-35.
5. **A bundle analysis** of both frontends, for the SUSPECTED bundle findings.
6. **A production network tab** on the staff calendar for link prefetch (FEP-08), and `x-vercel-cache` on a repeated CDN request (O-02).

## 8. To confirm outside this repository

- Postgres `max_connections`, `shared_buffers` and `work_mem` on the shared host, and how many connections staging and production together may take.
- The backend container's memory limit. The pipeline audit found one recorded out-of-memory kill.
- Whether Traefik compresses responses, and its read and idle timeouts.
- Docker log rotation on the host.
- Docker's `stop_grace_period` for the backend service.
- The Resend plan actually in use.
- Backup schedule and a tested restore.

## 9. Already right

Checked by the audits and found sound, so nobody re-litigates them:

- The app connects as the non-owning `booking_app` role and the Tenant setting is transaction-local.
- No in-process cache can serve one studio's data to another; every cache is keyed by Tenant.
- Class booking is race-safe: no oversell and no double debit. Credit spend, member time-clash checks, cancel retry and lock ordering, and waitlist join and promotion are all correct.
- Admin actions against a class (capacity edit, cancel class, staff booking, waitlist, check-in) serialise correctly with concurrent member bookings.
- Webhook idempotency is backed by unique indexes, and a grant is idempotent per purchase.
- Foreign-key index coverage is complete apart from two partial-only cases.
- No session write per request; the Tenant lookup and the maintenance check are cached.
- The error handler leaks no internals, and no dev or debug route is reachable in production.
- The member app has no retry storms, dedupes in-flight reads, guards every mutating button against a double submit, and never loads Stripe.js. Receipts are paginated.
- The staff app never auto-retries and gives every request a 15 s deadline. Neither app uses SSE or WebSockets, so nothing holds a connection open.
- No unused runtime dependencies in the backend; the member app's dependencies are lean.

Each report's own "checked and fine" section has the full list with file references.
