# Audit 2 — background jobs, external integrations, server process

Scope: `be/src/jobs/`, `be/src/routes/webhooks/`, outbound Stripe / Resend / R2 / logo calls, `cdn/`, `be/src/server.ts`, `be/src/app.ts`, `be/src/lib/`, `be/Dockerfile`, `.github/workflows/deploy-be.yml`.
Read-only. Nothing was run, no repo file was changed. Every finding cites code; CONFIRMED = the code proves the mechanism, SUSPECTED = the mechanism is in the code but the size of the effect needs a measurement or a fact that lives outside this repo (the compose file and Traefik config are in the infra repo).

Target load reasoned about: ~100 concurrent members + ~10 concurrent admins, several tenants, one backend container.

---

## (a) How it works

**Process.** One Node 22 container per environment on one VPS (`bpvps2`), started as `tsx src/server.ts` (`be/Dockerfile:12`). `server.ts` opens the HTTP socket with `@hono/node-server`, then dynamically imports `./jobs` and calls `registerJobs()`. There is no worker process, no queue and no Redis: HTTP, cron, the mail send gate, the archive-import runner and every cache live in the same event loop and the same heap. `docs/md/deployment.md:528` states the constraint outright: "Every server process runs them, so run one backend instance per database."

**Database context.** Every tenant request runs inside `withTenant` (`be/src/middleware/tenant.ts:102`), which is one `pool.transaction` holding one pooled connection for the whole request (`be/src/db/index.ts:58-85`). The pool is `postgres(url)` with no options (`be/src/db/index.ts:27`), i.e. postgres.js's default of 10 connections. That number is the DB auditor's to size, but it is the ceiling almost every finding below runs into, because jobs, webhooks, after-commit mail and requests all draw on it.

**Cron.** `node-cron` 4.6.0, nine schedules (`be/src/jobs/index.ts:167-175`). Seven are per-tenant: each tick calls `listJobTenants()` and then loops the tenants serially, one `withTenant` transaction per tenant (`perTenant`, `jobs/index.ts:56-82`). Daily jobs ride a 15-minute grid and ask each tenant "is it your local hour, first slot?" (`jobs/local-time.ts:61-64`). Two are platform-wide single statements. A per-tenant failure is caught and logged; a whole-job failure is caught by `safeJob`. There is no overlap guard, no advisory lock, no persisted "last run" and no catch-up.

**Mail.** `sendTemplatedEmail` inserts an `email_log` row (`queued`), awaits `sendMail`, then updates the row (`services/notifications/send.ts:221-292`). `sendMail` goes through one in-process send gate (`lib/send-gate.ts`): two lanes (credential first), 8 sends a second, up to 5 attempts with backoff, idempotency key = the `email_log` id. Business mail is registered with `afterCommit` and runs after the request's transaction commits, but **before the response is returned** (`db/index.ts:83`), each piece in a new `withTenant` transaction of its own. Sign-in codes and reset links are sent **inside** the request transaction (`services/auth/sign-in-mail.ts:26-29`).

**Stripe.** One client per studio account, built from the studio's own sealed key, SDK timeout 8 s and SDK retries off (`lib/stripe.ts:51-60`). Every call goes through `outbound()` (`lib/outbound.ts`), which adds a deadline, one log line, and retries only when the caller passes `OFF_REQUEST_RETRY` (3 attempts). Webhooks arrive at `/api/v1/webhooks/stripe/:slug`, are verified against that studio's secret, and are handled synchronously before the 200.

**R2.** S3 client with 3 s connect / 8 s socket timeouts, no SDK retries (`lib/r2.ts:19-42`). Uploads are buffered (5 MB caps) and `PutObject`-ed from inside the request. Reads go to `R2_PUBLIC_URL`, fronted by the Vercel edge function in `cdn/api/asset.ts`.

**Deploy.** `deploy-be.yml` builds and pushes the image, SSHes to the host, snapshots the DB, runs migrate + seed in a one-off container, boots a **smoke container of the new image with the real env on the real network**, probes `/health`, then `docker compose up -d --wait` recreates the serving container.

---

## (b) Inventory

### Cron jobs

Every schedule is in `be/src/jobs/index.ts:167-175`. "Tenant loop" = `listJobTenants()` (1 query) then, per tenant, `BEGIN` + `set_config` + work + `COMMIT`.

| # | Job | Schedule | Code | Work per run | Bounded? | Overlap guard | Safe if two processes fire it |
|---|---|---|---|---|---|---|---|
| 0 | `loadFeatureFlags` (boot only) | once, before any schedule is registered | `jobs/index.ts:165`, `services/feature-flags.ts:26-29` | Tenant loop; 1 `SELECT * FROM feature_flags` per tenant, merged into a process Map | yes | n/a | Each process has its own copy (finding S-06) |
| 1 | `expireStaleSessions` | `*/5 * * * *` | `services/pt-sessions/cancel.ts:540-561` | Tenant loop; 1 unbounded `SELECT` of pending PT requests past `expires_at`, then **per row** `cancelPtRequest`: savepoint, `SELECT … FOR UPDATE`, ledger refund, update (about 6-10 statements), plus one after-commit email per row | no `LIMIT` | none | Yes: row lock, then `noop` on a terminal status (`cancel.ts:157-164`) |
| 2 | `completeEndedPtSessions` | `*/5 * * * *` | `cancel.ts:570-590` | Tenant loop; 1 `SELECT … FOR UPDATE` + 1 `UPDATE` when anything matched | set-based | none | Yes: idempotent set update |
| 3 | `expireWaitlists` | `*/5 * * * *` | `services/waitlist/line.ts:326-338` | Tenant loop; 1 `UPDATE … WHERE class_id IN (SELECT every class that has started)` `RETURNING id` | set-based, but the subquery is every started class the studio has ever had (J-10) | none | Yes: idempotent |
| 4 | `sendCheckInNags` | `*/15 * * * *` | `services/bookings/check-in-nag.ts:60-67` | Tenant loop; 2 claiming `UPDATE … RETURNING` + up to 3 batched reads; after commit, per claimed session: 4 reads + 1 email to the instructor + 1 per admin, each email = insert, Resend call, update | 3-day look-back | none | Yes: claim-in-the-same-statement (`check-in-nag.ts:126-139`) |
| 5 | `expirePackages` | 15-min grid, tenant-local 01:00 | `services/packages/expire.ts:20-39` | Tenant loop with the hour check before the transaction; 1 `UPDATE … RETURNING` + `recordExpired` | set-based | none | Yes: `active = true` predicate |
| 6 | `pruneStaffUpdates` | 15-min grid, tenant-local 03:00 | `services/attention/updates.ts:366-370` | 1 `DELETE … RETURNING id` for rows older than 90 days | set-based; `RETURNING` materialises every deleted id just to count them | none | Yes |
| 7 | `sendLapsingAlerts` | 15-min grid, tenant-local 08:00 | `expire.ts:55-112` | 1 joined `SELECT` (no `LIMIT`), then **per row, inside the tenant's transaction**: switch read, template read, insert `email_log`, Resend call, update, headroom count | no | none | **No**: no marker, no claim; a second run sends every reminder again (J-02) |
| 8 | `releaseExpiredFormerSlugs` | `0 3 * * *` UTC | `services/tenants/former-slugs.ts:171-177` | 1 `DELETE` | yes | none | Yes |
| 9 | `suspendEndedTerms` | `*/15 * * * *` | `services/tenants/term.ts:65-88` | 1 `UPDATE tenants`, cache drop when anything changed | yes | none | Yes for the data; each process only clears its own cache |

Other background work that is not a cron job:

| Work | Trigger | Code | Note |
|---|---|---|---|
| After-commit work (mail, R2 deletes) | every `withTenant` that registered any | `db/index.ts:113-130` | Sequential, each in its own transaction, awaited before `withTenant` returns |
| Mail send gate pump | every send | `lib/send-gate.ts:180-197` | In-memory queue; lost on exit |
| Archive import runner | `PUT /platform/tenants/:id/imports/:jobId/archive` | `services/tenants/import-jobs.ts:402-442` | `void runImport(...)`, up to 1 GB held in memory, heartbeat every 5 s |
| Stale-import expiry | on read of a studio's import | `import-jobs.ts:154-171` | No cron; fine |
| Rate-limiter sweep | `setInterval(windowMs)` per limiter | `hono-rate-limiter` MemoryStore | `unref`'d |
| Nightly coverage | GitHub `0 3 * * *` | `.github/workflows/be-coverage.yml:14` | CI only |

### Outbound call sites

| Vendor | Operation | Call site | Deadline | Retry | Runs inside a DB transaction? |
|---|---|---|---|---|---|
| Stripe | `checkout.sessions.create` (+ `customers.create` first) | `services/billing/checkout-session.ts:373-403`, `payment-customers.ts:166` | 8 s each | none | Yes, the request's |
| Stripe | `checkout.sessions.retrieve` (sync-session) | `routes/client/purchases.ts:431` | 8 s | none | Yes, and then opens a second one (W-03) |
| Stripe | `paymentIntents.retrieve` (`latestCharge`) | `services/billing/payment-methods.ts:55-60` | 8 s | 3 attempts from the webhook | Yes, the delivery's; called 2-3+ times per delivery (W-02) |
| Stripe | `refunds.create` | `services/billing/refunds.ts:790-795` | 8 s | none; idempotency key `refund:<intent>` | Yes, the request's (by design, `refunds.ts:799-806`) |
| Stripe | `checkout.sessions.expire` / `retrieve` | `refunds.ts:1105-1112`, `services/packages/promo-redemption.ts:367-379` | 8 s | none | Yes |
| Stripe | `paymentMethods.list` / `retrieve` / `detach`, `customers.update` / `del` | `payment-customers.ts:257, 342, 353, 399, 460` | 8 s | none | Yes |
| Stripe | `webhookEndpoints.create` / `update` / `list` / `del` | `services/billing/provider-onboarding.ts:163, 272, 358, 407` | 8 s | none | Super portal, no tenant transaction |
| Stripe | `accounts.retrieve` (key probe) | `lib/stripe.ts:222` | SDK's 8 s only; **not through `outbound`**, so no log line | none | No |
| Stripe | `webhooks.constructEvent` | `services/billing/webhook-verification.ts:55` | local CPU | n/a | No |
| Resend | `emails.send` | `lib/mailer.ts:208` behind `lib/send-gate.ts` | 5 s per attempt | gate: 5 attempts, backoff to 30 s, honours `retry-after` | Yes: the after-commit piece's own transaction, or the request's for sign-in mail |
| Resend | `emails.receiving.get` (ClassPass inbound) | `services/classpass/inbound.ts:46-59` | 5 s | 3 attempts | No, fetched before `withTenant` (`inbound.ts:114-115`) |
| Resend | `webhooks.verify` | `routes/webhooks/resend.ts:27` | local CPU | n/a | No |
| R2 | `PutObject` | `lib/r2.ts:75-87`; callers `profile-pictures/pictures.ts:53`, `catalog/merch.ts:119`, `leave/requests.ts:866` | 8 s | none | Yes, the request's |
| R2 | `DeleteObject` | `lib/r2.ts:94-126` | 8 s awaited, then 3 attempts in the background | background only | After commit |
| R2 | `ListObjectsV2` + `DeleteObjects` | `lib/r2.ts:136-163`; caller `tenants/delete.ts:205` | 8 s per page | none | Super portal |
| R2 | signed GET URL (local signing) | `lib/r2.ts:167-171`; caller `leave/requests.ts:942`, TTL 300 s (`requests.ts:809`) | none needed | n/a | n/a |
| Logo host | `fetch(logoUrl)` for a Receipt PDF | `services/receipts/logo.ts:36-64` | 3 s | none | Yes, the request's or the after-commit piece's |
| R2 public (via CDN) | `fetch(R2_ORIGIN/key)` | `cdn/api/asset.ts:48-53` | **none** | none | n/a (Vercel edge) |

---

## (c) Findings

Severity: **P0** will break or corrupt at the target load · **P1** real cost or risk at the target load · **P2** waste or below production practice · **P3** nit.

### Mail

#### M-01 · P0 · CONFIRMED · The platform sender is on Resend's Free plan: 100 emails a day for every studio, staging and production together
- `be/src/lib/send-gate.ts:44-46` hard-codes `DAILY_QUOTA = 100`, `MONTHLY_QUOTA = 3000` ("Resend Free's caps").
- `docs/md/email-deliverability-runbook.md:4` — "the one platform sender, `noreply@reservetoday.app`, on the Resend Free plan. Every studio's mail leaves on it"; `:14-15` — 100 a day, 3,000 a month; `:185` — hitting the daily cap "blocks sign-in codes until midnight UTC".
- `send-gate.ts:6-7`: the limit is per team, so staging draws on the same pool.
- A quota refusal is never retried and fails the send (`send-gate.ts:225-228`); `deliver` swallows it and files `failed` (`send.ts:274-291`).

At 100 members + 10 admins: members sign in with an emailed code (`sign_in_code`), so 100 sign-ins alone is the whole day's allowance before a single booking confirmation, purchase receipt, cancellation notice or staff second factor. One cancelled class with 30 bookings is 30 emails. Once the cap is hit, nobody can sign in by code on any studio until 00:00 UTC, and the request still answers as though the code was sent.

Fix: move to a paid Resend plan before this load (the runbook already models Pro at `:189`), then make the two quota constants configuration (`RESEND_DAILY_QUOTA` / `RESEND_MONTHLY_QUOTA`, unset = no daily cap) so the headroom warnings stay true. Give staging its own Resend team or a hard staging send cap so a staging test run cannot spend production's allowance. Surface a failed credential send to the caller instead of a silent success.

#### M-02 · P1 · CONFIRMED · A request does not answer until its emails are handed to Resend, and each email in flight holds a pooled connection in an open transaction
- `be/src/db/index.ts:83` — `await runAfterCommit(tenantId, work)` runs before `withTenant` returns, and `withTenant` is what the request middleware awaits (`middleware/tenant.ts:102`).
- `db/index.ts:120-130` — each piece of work runs in a fresh `withTenant`, i.e. `BEGIN` on a pooled connection.
- `services/notifications/send.ts:231-272` — inside it: insert `email_log`, `await sendMail` (queue wait + network), update `email_log`. The connection is idle-in-transaction for the whole wait.
- Loops are sequential: `send-booking-email.ts:278-297, 326-346, 357-375, 471, 527`, `send.ts:335-337`.
- `lib/send-gate.ts:41, 43, 48-49` — 8 a second, 5 attempts, backoff up to 30 s; `outbound.ts:36` — 5 s per attempt. A rate-limit refusal holds the **whole** gate (`send-gate.ts:237-240`).

At the target load: an admin cancelling a class of 30 waits for 30 sequential sends (about 4 s of pacing plus 30 Resend round trips, typically 8-15 s) before the portal gets its 200, with one connection busy throughout. When Resend is slow or down, each email costs up to 5 × 5 s plus about 15 s of backoff, about 40 s, holding a connection; ten such requests at once is the default pool of 10, and every other request on every studio queues behind them. Sign-in is worse placed: `sign-in-mail.ts:26-29` sends inside the request's own transaction, so 30 members asking for a code at class time hold 10 connections while the gate drains at 8 a second.

Fix: make mail a real outbox. Write the `email_log` row as `queued` in the business transaction (or in after-commit), return, and let a single worker loop in the process (later a separate worker) claim `queued` rows with `FOR UPDATE SKIP LOCKED`, send, and mark them. That removes the request's wait, removes the connection held across the network call, makes retries survive a restart (M-03), and makes the send safe with two instances. Until then, at least do not hold a transaction across `sendMail`: commit the insert, send with no connection held, then update.

#### M-03 · P1 · CONFIRMED · Mail queued in memory is lost on every restart, and its `email_log` row stays `queued` forever
- The queue is two arrays in the gate's closure (`lib/send-gate.ts:155`).
- Shutdown calls `server.close`, then `closeDb`, then `process.exit`, with a forced exit at 10 s (`server.ts:37-55`). Nothing drains the gate.
- No code ever re-reads a `queued` row: the only writers of that status are the insert at `services/notifications/send.ts:241` and the column default (`db/schema/content.ts:74`).
- After-commit work registered by a cron job mid-flight is lost the same way (the check-in nag accepts this in its own header, `check-in-nag.ts:11-18`).

At the target load: every deploy is a restart. Any confirmation, receipt or sign-in code waiting in the gate (which is where they pile up exactly when Resend is throttling) is dropped silently; support sees a `queued` row that never moves and cannot tell "still waiting" from "lost".

Fix: the outbox in M-02 solves it. Short of that, on boot mark `queued` rows older than a few minutes `failed` with a reason, and drain the gate (bounded) in the shutdown path before closing the pool.

#### M-04 · P2 · CONFIRMED · Every delivered email runs an extra cross-tenant count query and writes an extra log line
- `lib/send-gate.ts:284` calls `checkHeadroom` after every successful send; `:269` awaits `sentToday()`.
- `lib/mailer.ts:144-154` — `sentToday` is `SELECT public.email_log_sent_today()` in its own savepoint: a count of today's `sent` rows across every tenant.
- `send-gate.ts:262` logs `mail: resend monthly usage` on every send, on top of the `outbound call` line (`outbound.ts:164-167`).

Cost: 3 extra statements (savepoint, count, release) per email, and the count grows through the day. Fix: keep a process counter seeded once per UTC day (or re-read at most once a minute), and log usage when it crosses a threshold rather than per send.

#### M-05 · P2 · CONFIRMED · Recipient email addresses are written to the logs shipped off the host
- `services/notifications/send.ts:279-284` — `reportError(err, 'email send failed', { …, to: recipient.email, … })`.
- `middleware/tenant.ts:66-69` logs the full `origin` (low risk).
- By contrast `delivery-outcomes.ts:60` deliberately "never the address".

Logs go to Grafana Cloud Loki (`docs/md/observability-runbook.md:312`). During a Resend outage this writes every member's address at `error`. Fix: log `recipientUserId` and `recipientKind`; the address is already on the `email_log` row.

#### M-06 · P3 · CONFIRMED · A second backend instance doubles the send rate
`lib/send-gate.ts:33-34` says so itself. Listed so the single-instance inventory (S-06) is complete; the outbox in M-02 with one sender removes it.

### Cron jobs

#### J-01 · P1 · CONFIRMED · Every deploy boots a second full backend, cron included, against the live database
- `.github/workflows/deploy-be.yml:792-795` — `docker run -d --name "$SMOKE" --env-file "$STACK/.env.booking-be" --network booking-<env>-network <new image>`: the image's default command, `tsx src/server.ts`, with the real `DATABASE_APP_URL`, `RESEND_API_KEY` and so on.
- `be/src/server.ts:25-32` — every server process registers the jobs; there is no switch (`docs/md/deployment.md:528`).
- The smoke container lives for up to 20 × 2 s (`deploy-be.yml:797-806`) while the old container is still serving.
- No job takes an advisory lock or checks leadership (`jobs/index.ts` has none; the only `pg_advisory_xact_lock` in the slice is for slugs, `former-slugs.ts:55`).

Consequence: if the smoke window covers a `:00/:05/:10…` minute boundary, both processes fire the same tick. Most jobs tolerate that (inventory column), but `sendLapsingAlerts` does not (J-02), the mail gate's pacing doubles, and the smoke container is then `docker rm -f`'d (`:814`), which kills a job mid-run and drops whatever mail it had queued. Deploys happen in the studios' daytime, which is when 08:00 local falls for a new timezone.

Fix, both halves: (1) add `RUN_JOBS` (default on) and start the smoke container with it off, or smoke-test with a dedicated command that boots the app without `registerJobs`; (2) make the jobs safe regardless: wrap each tick in `pg_try_advisory_lock(hashtext('job:<name>'))` on a dedicated connection and skip when it is held. Half 2 also removes the "one instance per database" constraint for cron.

#### J-02 · P1 · CONFIRMED · `sendLapsingAlerts` has no record of what it sent: a second run duplicates every reminder and a missed run loses them for good
- `services/packages/expire.ts:46-49` — "The window is one day wide and the job runs once a day, so each package falls inside it on exactly one run — that is what makes the reminder go out once, with no marker to keep."
- The idempotency key is the new `email_log` row's id (`send.ts:248-257`), so two runs produce two different keys and Resend sends both.
- The job runs only on the tick where `hour === 8 && minute < 15` (`jobs/local-time.ts:61-64`). A process that is down, restarting or mid-deploy at that one tick skips the day, and tomorrow's window (`expire.ts:81-82`, 6.5 to 7.5 days out) has moved past those packages.

Triggers for a double run: the smoke container (J-01), any future second instance, a manual restart racing the tick. Triggers for a miss: a deploy or crash at 08:00 local.

Fix: add `expiry_reminder_sent_at` to `client_packages`; claim rows with `UPDATE … SET expiry_reminder_sent_at = now() WHERE … AND expiry_reminder_sent_at IS NULL AND expires_at < now() + interval '7.5 days' RETURNING …` (the pattern `check-in-nag.ts:126-139` already uses) and widen the window to "anything expiring within 7.5 days not yet reminded", which gives catch-up for free.

#### J-03 · P1 · CONFIRMED · `sendLapsingAlerts` sends its emails inside the tenant's transaction, not after it
- `expire.ts:93-111` — `await sendTemplatedEmail(...)` in a loop, directly in the job body, which `perTenant` runs inside `withTenant` (`jobs/index.ts:72-76`). No `afterCommit`.
- Each send is paced and retried by the gate (M-02 figures).

A studio with 40 packages lapsing next week holds one pooled connection in one open transaction for the whole run: about 5 s when Resend is healthy, minutes when it is throttling, during the morning booking peak. Because tenants are processed serially, the next studio's 08:00 reminders wait behind it. The comment in `db/index.ts:51-56` names exactly this as the thing not to do.

Fix: with J-02's claim, register one `afterCommit` per claimed row (as the check-in nag does), or better, enqueue to the outbox.

#### J-04 · P1 · CONFIRMED · If the first job registration fails, the process serves traffic with no cron jobs at all, and nothing alerts
- `be/src/server.ts:25-32` — `registerJobs()` is awaited in a promise chain whose `catch` only logs `failed to register background jobs`.
- `jobs/index.ts:165` — the first thing it does is `await perTenant('loadFeatureFlags', loadFeatureFlags)()`, which calls `listJobTenants()` **outside** the per-tenant `try` (`jobs/index.ts:63`). A database blip at boot rejects it and none of the `cron.schedule` lines below ever run.
- The HTTP server is already listening (`server.ts:21`), and `/health` only checks `SELECT 1` (`app.ts:182-189`), so the container is healthy.
- The job-stale alert covers only two daily jobs with a 25-hour window (`docs/md/observability-runbook.md:256`).

Consequence: pending PT requests never expire, held credits never return, packages never expire, for up to a day before anyone is told. The same boot failure also leaves the feature-flag cache empty (S-05).

Fix: schedule the cron jobs first and prime the flags in a retry loop, or treat a failed registration as fatal (`process.exit(1)`) so the container restarts and the deploy's `--wait` fails. Add job liveness to `/health` (last successful tick per job) and an alert on the `*/5` heartbeat with a 15-minute window.

#### J-05 · P2 · CONFIRMED · No overlap protection; a slow run stacks on the next tick
- `jobs/index.ts:167-175` passes no options; node-cron 4.6.0 defaults `noOverlap` to `false` (`node_modules/node-cron/dist/_shared.js`).
- The serial tenant loop plus in-transaction or after-commit mail means a run's length is unbounded (J-03, M-02). `sendCheckInNags` awaits its after-commit mail inside the tenant loop (`db/index.ts:83`).

Data stays correct where the job is idempotent, but overlapping runs each hold a connection and re-scan the same rows. Fix: `{ noOverlap: true }` on every schedule (one line each), plus the advisory lock from J-01 for cross-process safety.

#### J-06 · P2 · SUSPECTED · Eight jobs fire in the same millisecond every quarter hour and each takes a pooled connection
- Three `*/5` and five `*/15` schedules (`jobs/index.ts:167-175`) coincide at `:00/:15/:30/:45`. Each calls `listJobTenants()` separately (8 identical queries) and then holds one connection while it walks the tenants.

Against a pool of 10 that leaves two connections for 110 users for the length of the sweep, every 15 minutes. Needs a measurement of sweep duration to size. Fix: one scheduler tick that reads the tenant list once and runs the due jobs sequentially (or with a concurrency of 2), or stagger the minutes (`1-59/5`, `2-59/15`, …).

#### J-07 · P2 · CONFIRMED · Daily jobs have no catch-up after downtime
- `jobs/local-time.ts:61-64` — a daily job runs on exactly one 15-minute slot per local day; nothing persists "ran for 2026-11-13".
- `expirePackages` missed at 01:00 leaves `client_packages.active = true` on expired packages until the next night. Whether booking paths also compare `expires_at` is the client-API auditor's to confirm; if they rely on `active`, an expired package is spendable for a day.

Fix: make the predicate the catch-up. Run `expirePackages` and `pruneStaffUpdates` on every tick (they are single indexed set-based statements and no-ops when there is nothing to do), and drop the hour check for them entirely. Keep an hour only where the hour matters to a human (the 08:00 reminder), with J-02's marker.

#### J-08 · P3 · CONFIRMED · The "hours no zone skips" claim is wrong for some zones
`jobs/local-time.ts:56-59` says the daily hours are ones no zone skips. In `Europe/London`, `Europe/Dublin` and `Europe/Lisbon` the spring change goes 01:00 → 02:00, so local 01:xx does not exist and `expirePackages` (local hour 1, `jobs/index.ts:138`) does not run that day. In zones that fall back 02:00 → 01:00 (North America) hour 1 occurs twice and it runs twice, which is harmless. No current studio is in such a zone as far as the code shows; J-07's fix removes the problem.

#### J-09 · P3 · CONFIRMED · `expireStaleSessions` is N+1 by design, unbounded, and serial
`cancel.ts:542-560` — one unbounded select, then a full `cancelPtRequest` per row, then (after commit) one email per row sequentially (`send-pt-request-email.ts:124-127`). Volume is tiny at this load (a handful of pending requests per studio). Add `LIMIT 200` and an `ORDER BY expires_at` so a backlog after downtime cannot produce one giant transaction.

#### J-10 · P3 · SUSPECTED · `expireWaitlists` re-scans every started class every 5 minutes
`waitlist/line.ts:328-336` — `class_id IN (SELECT id FROM classes WHERE starts_at <= now)` is every class the studio has ever run. With an index usable for `waitlist_entries(status)` it is cheap; without one it is a growing scan 288 times a day per tenant. Index question belongs to the DB auditor; the cheap code fix is to bound the subquery (`starts_at > now - interval '2 days'`) and join instead of `IN`.

#### J-11 · P3 · CONFIRMED · `pruneStaffUpdates` returns every deleted id to count them
`attention/updates.ts:368-369` — `DELETE … RETURNING id` then `.length`. Use the command's row count.

### Webhooks

#### W-01 · P1 · CONFIRMED · A Stripe delivery is fully processed, with several Stripe API round trips, before the 200 is sent, all inside one transaction
- `routes/webhooks/stripe.ts:62-64` awaits `handleStripeEvent` with `OFF_REQUEST_RETRY` before answering.
- `services/billing/webhook-handler.ts:616` — the whole delivery is one `withTenant` transaction.
- Inside it, on the ordinary paid path for a package: `purchaseForPayment` locks the Purchase `FOR UPDATE` (`:176`), `withReturnsHeard` calls `latestCharge` once per other payment (`:238-239`), `settleAndMayGrant` calls `latestCharge` (`:289`), then `chargePatch` calls `latestCharge` **again for the same intent** (`:725` → `:89`). Each `latestCharge` is `paymentIntents.retrieve` with an 8 s deadline and 3 attempts (`payment-methods.ts:55-60`, `outbound.ts:59`).
- Then the receipt is issued and, after commit but still before the 200, the confirmation email is rendered with its PDF (which fetches the studio logo over HTTP, `receipts/logo.ts:36`) and sent through the gate.

Worst case per delivery when Stripe is slow: 2 × (3 × 8 s + backoff) ≈ 55 s holding a connection and a row lock on the Purchase, then the mail wait. Stripe treats a slow endpoint as failed and redelivers, and the redelivery queues on the same Purchase lock, holding a second connection. At the target load purchases are bursty around class release times; a slow Stripe turns a handful of purchases into pool exhaustion for every studio.

Fix: (1) verify, persist the raw event in a `stripe_events` table keyed on `(tenant_id, event.id)` with `ON CONFLICT DO NOTHING`, answer 200, and process from that table in a worker (same outbox loop as M-02); (2) regardless, fetch the charge **once** per delivery, before opening the transaction, and pass it down; (3) send the confirmation off the request path.

#### W-02 · P2 · CONFIRMED · `latestCharge` is fetched twice for the same intent in every successful delivery
`webhook-handler.ts:289` (in `settleAndMayGrant`) and `:725` / `:809` / `:869` / `:927` / `:1037` (via `chargePatch`, `:89`). `settleAndMayGrant` already has the charge in hand and uses it for `receiptOf` and `methodPatch` on its early-return paths (`:300`, `:318`). Return the charge from `settleAndMayGrant` and reuse it: one fewer Stripe call per purchase, one fewer 8 s exposure inside the transaction. The module header of `payment-methods.ts:4-6` says recording the method "costs no call of its own", which is no longer true.

#### W-03 · P2 · CONFIRMED · The confirmation page's `sync-session` holds two pooled connections per call
- `routes/client/purchases.ts:423-460` runs inside the request's `withTenant`, then calls `handleStripeEvent`, which opens its own `withTenant(named, …)` (`webhook-handler.ts:616`). `withTenant` always calls `pool.transaction` (`db/index.ts:64`); it does not reuse the open scope.
- `app.ts:138-141` explains this exact hazard ("hold two pooled connections for the length of a call to the provider") as the reason the webhook path is exempt from tenant resolution; the sync-session path does it anyway.
- It also races the real webhook by construction: both read `existingPayment` before taking the Purchase lock (`webhook-handler.ts:650-656`). The package and merch grants are idempotent (`packages/purchase.ts:464-470, 601-603`, `catalog/merch-orders.ts:131`), so no double grant, but the loser of the race on a Cross-Location Add-On logs `duplicate cross-location add-on payment … refund owed` (`webhook-handler.ts:786-805`) for a payment that was applied correctly: a false "refund owed" alarm.

Fix: have `sync-session` only read the outcome and, when the payment is not recorded yet, answer `pending` and let the page poll; the webhook is the one writer. If the fallback must stay, re-check `existingPayment` after the Purchase lock in every branch (the corporate branch already does, `:914`).

#### W-04 · P2 · CONFIRMED · No rate limit and no body cap on either webhook route
- Limiters are mounted only on `/api/v1/public/*`, `/me/*`, `/portal/*`, `/platform/*` (`app.ts:117-122`). `/api/v1/webhooks/*` has none.
- `routes/webhooks/stripe.ts:38` and `resend.ts:20` read the whole body with `c.req.text()` before any check; there is no `bodyLimit` (the only uses are `routes/profile-picture.ts:26`, `portal/leave.ts:109`, `portal/admin/merch.ts:87`).
- An unknown slug costs a database query each time, because the slug cache is positive-only (`services/tenants/tenants.ts:61-62, 125-135`).

An unauthenticated caller can post arbitrarily large bodies to `/webhooks/stripe/<anything>` at any rate; each is buffered in full and costs a query. Fix: `bodyLimit({ maxSize: 1 MB })` on both routes, a per-IP limiter with a generous budget, and check the `stripe-signature` header is present before reading the body.

#### W-05 · P2 · CONFIRMED · Stripe event ids are never recorded
Idempotency rests on payment-row status and unique indexes (`webhook-handler.ts:650-651, 672`), which hold for the grants. But there is no `(account, event.id)` ledger, so a redelivery repeats every read, the Purchase lock and the Stripe retrieves before discovering there is nothing to do, and there is no record of which events were received when support has to reconcile. The `stripe_events` table in W-01's fix covers both.

#### W-06 · P3 · CONFIRMED · `console.error` instead of the logger for money owed
`webhook-handler.ts:802-804`. It bypasses pino, so the line has no `level`, `tenantId` or `requestId` and matches no alert rule. Use `reportError`.

#### W-07 · P3 · CONFIRMED · Resend webhook reads its secret from `process.env`, and builds a client at import
`routes/webhooks/resend.ts:12, 16`. `RESEND_WEBHOOK_SECRET` bypasses `env.ts` validation, so a missing secret is a runtime 500 per delivery rather than a boot failure. Resend's own retries cover it; validate at boot.

### Outbound integrations

#### O-01 · P1 · CONFIRMED · Every tenant request holds a pooled connection for its whole life, including the request body upload and every vendor call
- `middleware/tenant.ts:102` opens the transaction before the route runs, so before the body is read: `bodyLimit` and `formData()` run inside it (`routes/profile-picture.ts:26-36`, `portal/leave.ts:109-129`, `portal/admin/merch.ts:87-106`).
- Vendor calls inside it: Stripe checkout (two calls, `checkout-session.ts:373-403`), refunds, saved cards, R2 `PutObject` (`pictures.ts:53`), logo fetch.
- `server.ts:19-21` raises Node's `requestTimeout` to 60 minutes **for every route** so the archive upload can finish.
- Pool default 10 (`db/index.ts:27`).

Two consequences at the target load. (1) Vendor slowness becomes API-wide slowness: ten concurrent checkouts against a Stripe answering in 5 s stall every other request on every studio. (2) An unauthenticated client can open ten `POST`s to any `/api/v1/public/*` route with a valid `X-Tenant-Slug`, send the headers, and trickle the body: each holds a connection for as long as the proxy in front allows (Traefik's read timeout is set in the infra repo; Node itself now allows an hour). The public limiter is 100 a minute per address (`app.ts:92-96`), so ten requests pass.

Fix: (a) scope the 60-minute `requestTimeout` to the archive route only (handle that route's socket timeout individually, keep the 5-minute default elsewhere, and add a short `headersTimeout` / body idle timeout); (b) read and validate the body before opening the tenant transaction for upload routes, and do the R2 `PutObject` before or after the transaction rather than inside it; (c) for checkout, create the Purchase, commit, call Stripe with no transaction, then attach the session id in a second short transaction (the Purchase is already designed to exist `open` with no session); (d) size the pool explicitly and add a statement and idle-in-transaction timeout (DB auditor).

#### O-02 · P1 · SUSPECTED · The CDN edge function probably never caches at the edge, so every first view hits the function and the rate-limited `r2.dev` origin
- `cdn/api/asset.ts:20, 25, 72` — the response carries `cache-control: public, max-age=31536000, immutable` (or `max-age=86400` for avatars). There is no `s-maxage` and no `CDN-Cache-Control`.
- Vercel's CDN caches a function's response when it carries `s-maxage` (or a `CDN-Cache-Control` / `Vercel-CDN-Cache-Control` header); `max-age` alone is a browser directive. This needs confirming against a live response (`x-vercel-cache` should read `HIT` on a repeat; if it reads `MISS` every time, this finding is confirmed).
- `asset.ts:11` — the origin is the bucket's `pub-<hash>.r2.dev` URL, which Cloudflare rate-limits and documents as not for production.
- `asset.ts:48-53` — the upstream `fetch` has no timeout.

At the target load: every member's first view of a roster or schedule with photos is one edge invocation and one `r2.dev` fetch per image, per member. A roster of 30 avatars × 100 members is 3,000 uncached origin fetches; `r2.dev` throttling shows as broken images across every studio.

Fix: add `s-maxage=31536000` (and `stale-while-revalidate`) for content-addressed keys and a shorter `s-maxage` for avatars; add `AbortSignal.timeout(10_000)` to the upstream fetch; add `x-content-type-options: nosniff`. Longer term, serve the bucket through an R2 custom domain on a Cloudflare zone (a separate asset domain avoids the nameserver constraint the ADR describes) and delete the proxy.

#### O-03 · P2 · CONFIRMED · Uploaded images are stored and served exactly as uploaded, up to 5 MB each
- `services/profile-pictures/pictures.ts:25, 53` — a 5 MB cap and a straight `putObject`; no resize, no re-encode (there is no image library in `be/package.json`). Same for merch (`catalog/merch.ts:12, 119`).
- Avatars are shown in lists (rosters, check-in desk).

A phone photo is 3-5 MB. A check-in desk showing 30 members downloads up to 150 MB of avatars. Fix: resize on upload (for example 256 px and 64 px WebP with `sharp`) and store the variants; or use Vercel/Cloudflare image resizing in front of the CDN. Cross-slice with both frontends.

#### O-04 · P2 · CONFIRMED · Every Receipt PDF render re-fetches the studio logo over HTTP and decodes it synchronously
- `services/receipts/pdf.ts:27-29` calls `studioLogo(studio.logoUrl)` on every render; `logo.ts:36` is a network fetch with a 3 s deadline, no cache. Renders happen on every download (`routes/receipt-views.ts:94-95`) and every purchase email (`receipts/email.ts:33`).
- `logo.ts:94` — `inflateSync` with `maxOutputLength` up to `4096 × 4096 × 8 + 4096` ≈ 134 MB, on the event loop. A large PNG logo blocks every request on every studio while it inflates.
- `logo.ts:30, 48` — `http:` is allowed and redirects are followed to any host, with a tenant-supplied URL: a server-side request forgery surface (the container can reach `db-booking` and the host network). Cross-slice, for the security auditor.

Fix: cache the validated logo bytes per `(tenant, logo_url)` in a small LRU (or store the PDF once at issue time in R2 and serve that); lower the pixel cap to something a 160-point logo needs (for example 1024 × 1024); require `https:`, refuse redirects to private address ranges.

#### O-05 · P2 · CONFIRMED · A studio archive of up to 1 GB is buffered whole in memory, twice, in the API process
- `import-jobs.ts:52` — `MAX_ARCHIVE_BYTES = 1 GB`; `:331, 355` collect chunks; `:397` `Buffer.concat(chunks)` makes a second copy; `:455` `unpackArchive` (jszip, in memory) a third representation, then every row as objects.
- The one-request route has no cap at all: `routes/platform/transfer.ts:115-127` — `parseBody()` then `file.arrayBuffer()` then `Buffer.from(...)`.
- Export is also whole-in-memory with an extra copy (`transfer.ts:55-56, 75-78`).
- It runs in the same process that serves every member.

A large restore during business hours can push the container past its memory limit; the kernel kills the API for every studio (the deploy file already records an OOM kill on this host, `deploy-be.yml:771-774`). Platform-operator only, so rare, but the blast radius is everyone. Fix: stream the upload to a temp file (or to R2) and unpack from disk with a streaming zip reader; cap the one-request route with `bodyLimit`; run restores in a one-off container (`docker compose run`) the way migrations already do.

#### O-06 · P3 · CONFIRMED · The Stripe key probe is the one vendor call that skips `outbound`
`lib/stripe.ts:222` — `probe.accounts.retrieve()` directly. It still has the SDK's 8 s timeout, but writes no `outbound call` line. Wrap it.

#### O-07 · P3 · CONFIRMED · `stripe` SDK 14.25 pinned to API version `2023-10-16`
`be/package.json:45`, `lib/stripe.ts:34`. Three years behind. Not a load problem; schedule the upgrade.

### Server process

#### S-01 · P1 · CONFIRMED · The authenticated rate limiter is keyed by IP, not by user, and the public one is shared by a whole studio's wifi
- `app.ts:97-102` — `authedLimiter` keys on `c.get('clientId') ?? c.get('staffUserId') ?? x-forwarded-for ?? 'global'`.
- It is mounted at `app.ts:120-122`, before the routes. `hono-rate-limiter` 0.4.2 calls `keyGenerator` **before** `next()` (`node_modules/hono-rate-limiter/index.esm.js`: `const {key,…} = await r(t,h,g)` precedes `await i()`), and `clientId` / `staffUserId` are only set by the auth middlewares inside the routes (`middleware/client-auth.ts:64`, `middleware/staff-auth.ts:85`). So both are always `undefined` when the key is computed.
- Effective behaviour: 300 requests a minute per client IP across `/me`, `/portal` and `/platform`; 100 a minute per IP on `/public` (`app.ts:92-96`).
- With no `X-Forwarded-For` (any server-side caller), everyone shares the literal key `'global'` (`app.ts:95, 101`); the code comments at `app.ts:104-108` record this already biting once.

At the target load: a studio's front desk, its admins and the members on its wifi are one IP. Thirty members opening the app before a class, each page load fanning out to several `/me/*` and `/public/*` calls, plus the check-in desk polling, exceeds 300 and 100 a minute easily; everyone at that studio gets 429s at the busiest moment. Members on mobile data behind carrier NAT share budgets with strangers.

Fix: move the authed limiter after authentication (mount it inside the `me` / `portal` routers after the auth middleware, or resolve the session token to an id in the key generator) so it is truly per user; raise the per-IP public budget and key it on `(ip, tenant)`; never fall back to `'global'` (skip limiting instead, or key on the tenant). Confirm Traefik overwrites rather than appends client-supplied `X-Forwarded-For`, or the key is attacker-chosen.

#### S-02 · P1 · CONFIRMED · Deploys are not zero-downtime and cut in-flight work at 10 seconds
- `deploy-be.yml:839` — `docker compose up -d --remove-orphans --wait` recreates the one container: the old one is stopped, then the new one started, and it must boot (`tsx` transpiles the whole source tree at start, `Dockerfile:12`) and pass its healthcheck before Traefik routes to it.
- `server.ts:37-55` — on SIGTERM: `server.close`, then a forced `process.exit` at 10 s. Cron tasks are not stopped, the mail gate is not drained (M-03), a running archive import is abandoned (`import-jobs.ts:64-65` describes the result).
- Migrations run against the live database while the old code is still serving (`deploy-be.yml:780`), which is safe only while every migration is additive (`observability-runbook.md:299-301` says so).

At the target load: each deploy is several seconds of 502/404 for every studio, any request slower than 10 s (a class cancel with many emails, M-02) is killed, and Stripe deliveries in the gap are retried later. With frequent deploys in studio hours this is visible.

Fix: run two containers behind Traefik and roll them (needs J-01's job lock and S-06's shared state first), or at minimum start the new container beside the old one and stop the old one after the new one is healthy. In shutdown: stop the cron tasks, stop accepting, wait for in-flight requests and the mail gate up to a grace period that matches the compose `stop_grace_period` (raise both to about 30 s), then close the pool.

#### S-03 · P1 · SUSPECTED · Pool exhaustion fails `/health`, which can take the container out of rotation
- `app.ts:182-189` — `/health` runs `SELECT 1` on the same 10-connection pool as everything else, with no timeout of its own.
- The deploy and the uptime probes use `/health` (`deploy-be.yml:798`, `observability-runbook.md:255`). If the compose healthcheck (infra repo) uses it too, a pool starved by M-02 / W-01 / O-01 makes the container unhealthy, and Traefik's Docker provider stops routing to unhealthy containers: a slowdown becomes a full outage for every studio.

Fix: point the container healthcheck at `/api/v1/healthz` (liveness, no database, `app.ts:180`) and keep `/health` for the external readiness probe; give `/health` a 1-2 s timeout and a dedicated connection.

#### S-04 · P2 · CONFIRMED · No response compression
There is no `compress()` anywhere in `be/src` (grep for `hono/compress` finds nothing) and nothing in this repo configures it at Traefik. JSON list responses (schedule, rosters, finance lists, CSV exports at `routes/portal/admin/finance.ts:130`, `receipts.ts:75`) go out uncompressed. Fix: `app.use(compress())` for JSON/CSV above about 1 KB, or enable Traefik's `compress` middleware in the infra repo (preferable: keeps CPU off the event loop).

#### S-05 · P2 · CONFIRMED · No global request body limit and no per-route timeout
- `bodyLimit` exists on three upload routes only. Every JSON route reads whatever is sent (zod validates after the whole body is parsed).
- No `hono/timeout` or equivalent (grep finds none); with `requestTimeout` at 60 minutes (`server.ts:19`) a stuck handler holds its connection until the proxy gives up.

Fix: a default `bodyLimit` of about 100 KB on `/api/v1/*` with the upload and archive routes opting out, and a default handler timeout of about 30 s that answers 503.

#### S-06 · P2 · CONFIRMED · In-memory state that is wrong the moment there are two instances (and some that is wrong with one)
| State | Where | Effect with two instances |
|---|---|---|
| Feature flags | `services/feature-flags.ts:13, 26-37, 64` | Loaded once at boot. `setFlag` updates only this process's Map, so the other instance never sees a toggle until restart. **Already wrong with one instance** for rows written without `setFlag`: an archive restore that brings `feature_flags` rows writes the table directly and the cache never learns (so a restored studio's waitlist reads as off until the next deploy), and `setFlag` writes the cache before the surrounding request transaction commits (`:64`), so a rolled-back request leaves the cache saying the opposite of the table. Also empty for the window between `listen` and `registerJobs` finishing (`server.ts:21-26`), and for the life of the process if J-04 fires. |
| App rate limiters | `app.ts:92-115` (MemoryStore) | Each instance has its own budget |
| Auth rate limits | `services/auth/rate-limit.ts:55-75, 130, 154, 194` | Sign-in and code-request budgets double; brute-force guard halves |
| Platform set-password cooldown | `services/auth/platform-first-sign-in.ts:35` | Per instance; also grows without bound, but only with allow-listed addresses |
| Mail send gate | `lib/send-gate.ts:155-162` | Pace doubles past Resend's limit (M-06) |
| Import job registry | `services/tenants/import-jobs.ts:68, 82` | The upload must land on the instance that started the job; the other one marks it stale |
| Tenant / credentials / mail-identity caches | `tenants.ts:65-67`, `provider-credentials.ts:57`, `mail-identity.ts:42` | 60 s TTL bounds the staleness; `forget…()` only clears the local copy, so a suspension or a rotated Stripe key takes up to a minute on the other instance |
| Stripe clients | `lib/stripe.ts:72` | Harmless; one entry per account and key digest, never evicted (a rotated key leaves the old client until restart) |

Fix: read flags with the same 60 s TTL pattern as the other caches (or straight from the table, it is one indexed row), and write the cache in `afterCommit`. Move the limiters to Postgres or Redis before a second instance exists. Persist the import request on the job row.

#### S-07 · P2 · CONFIRMED · The image runs TypeScript through `tsx` as root with dev dependencies installed
- `Dockerfile:7` `npm ci --include=dev`; `:12` `CMD ["node_modules/.bin/tsx", "src/server.ts"]`; no `USER`, no `HEALTHCHECK`, no memory flags, single stage.
- `tsx` transpiles on every boot (slower start, so longer deploy downtime, S-02) and keeps esbuild and a wrapper process in memory; the deploy file records that stacking a second `tsx` on this host was OOM-killed (`deploy-be.yml:771-774`).

Fix: multi-stage build that compiles to JS (`tsc` or `esbuild`), a runtime stage with production dependencies only, `USER node`, `CMD ["node", "--enable-source-maps", "dist/server.js"]`, and an explicit `--max-old-space-size` matched to the container limit. Keep a separate tools image (or stage) for migrate and seed.

#### S-08 · P2 · CONFIRMED · An unhandled rejection is logged and ignored
`server.ts:62-64`. Node's default would crash; this keeps a process in an unknown state running (for example a transaction callback that rejected after its scope moved on). Combined with fire-and-forget calls (`void runImport`, `void attempt(next)`, `void deleteObject(...)`) it is the right call only if each of those has its own catch (they do today: `import-jobs.ts:428`, `send-gate.ts:203-213`, `r2.ts:122-124`). Fix: count them as a metric and alert on any; consider exiting after logging, as for `uncaughtException`.

#### S-09 · P3 · CONFIRMED · The access-log skip names a path that does not exist
`middleware/logger.ts:38` skips `/health` and `/healthz`; the liveness route is `/api/v1/healthz` (`app.ts:180`). Every liveness probe writes an access line. Fix the string.

#### S-10 · P3 · CONFIRMED · Logging is synchronous to stdout with a per-line context mixin
`shared/logger.ts:81-84` — `pino(options)` with the default destination (synchronous). At 110 users this is a few hundred lines a minute and not a problem; noted so that when volume grows the change is `pino.destination({ sync: false })` plus a flush in `shutdown`. Volume today is 1 line per request plus 1 per vendor call plus 1-2 per email (M-04).

#### S-11 · P3 · CONFIRMED · `secureHeaders()` and CORS run on webhook and health routes
`app.ts:36, 46-66` apply to `*`. Harmless; the origin check is a string match per request (`lib/allowed-origins.ts`).

---

## (d) Checked and fine

- **Stripe signature verification.** One secret per studio selected by the URL slug, verified on the raw body before anything is trusted, flat 400 for every refusal (`routes/webhooks/stripe.ts:35-49`, `services/billing/webhook-verification.ts:41-60`). The body's tenant is then cross-checked (`webhook-handler.ts:524-531, 567-568`).
- **Resend signature verification.** Svix verify on the raw body before parsing (`routes/webhooks/resend.ts:20-35`).
- **Resend delivery outcomes** are order- and duplicate-tolerant by rank, and tenant-fenced by the signed tag (`services/notifications/delivery-outcomes.ts:36-57, 139-150`).
- **ClassPass inbound** fetches the message outside any transaction and dedupes on `(tenant, Message-ID)` (`services/classpass/inbound.ts:114-115`, `classpass/receive.ts:195-211`).
- **Grant idempotency.** A package grant is deduped on the Purchase by pre-check and unique index (`services/packages/purchase.ts:464-470, 601-603`); merch on `(tenant, intent)` (`catalog/merch-orders.ts:131`); the payment row insert is `onConflictDoNothing` (`webhook-handler.ts:672`); a refunded payment is never flipped back (`:384-399`).
- **Refund idempotency at Stripe.** `idempotencyKey: refund:<intent>` (`services/billing/refunds.ts:790-795`).
- **Refund-before-payment ordering** is handled by asking for redelivery (503) rather than acknowledging (`webhook-handler.ts:1075-1080`, `routes/webhooks/stripe.ts:66-72`).
- **Timeouts on every vendor call.** Stripe 8 s with SDK retries off (`lib/stripe.ts:54-59`), R2 3 s connect / 8 s socket with SDK retries off (`lib/r2.ts:25-29`), Resend 5 s (`lib/mailer.ts:208`), logo 3 s with a 2 MB streaming cap (`receipts/logo.ts:15, 47-64`). The only exceptions are O-02 (CDN fetch) and O-06.
- **Retries only off the request path**, with jittered backoff and a 4xx never retried (`lib/outbound.ts:127-153`).
- **Mail idempotency within one message.** The `email_log` id is the Resend idempotency key, so a gate retry cannot deliver twice (`services/notifications/send.ts:248-257`).
- **Credential mail priority.** Sign-in codes take the next slot ahead of queued everyday mail (`lib/send-gate.ts:190`).
- **The send gate's worker is detached** from the request's async context, so it does not inherit a closed tenant transaction (`send-gate.ts:163-173`).
- **Check-in nag** claims in the same statement that selects, bounded to a 3-day look-back, mail after commit (`services/bookings/check-in-nag.ts:20-25, 126-139`).
- **Per-tenant error isolation and timezone handling** in the job wrapper: one studio's failure or bad zone name does not stop the others; local hour comes from `Intl`, not an offset (`jobs/index.ts:63-80`, `jobs/local-time.ts:35-49`).
- **Tenant context is transaction-local** in jobs as in requests, so a job cannot leak a tenant onto a pooled connection (`db/index.ts:78`).
- **In-process caches are bounded.** Tenant and slug caches are positive-only with a 60 s TTL (`tenants.ts:61-73`); credentials and mail identity are keyed by real tenant ids; the auth limiter prunes past 10,000 keys (`auth/rate-limit.ts:60-62`); the app limiter's MemoryStore rotates two maps per window; the null mail transport keeps 50 messages (`mailer.ts:124-125, 137`). No unbounded growth found apart from the trivial cases in S-06.
- **No SSE, WebSocket or long-poll endpoints** exist in `be/src/routes`; nothing holds a response open by design.
- **Signed URL lifetime.** Supporting documents are signed for 300 s (`services/leave/requests.ts:809, 942`). (The bucket being public regardless is recorded in `lib/r2.ts:44-53` and belongs to the security auditor.)
- **Upload size limits** exist on all three upload routes, enforced before parsing (`routes/profile-picture.ts:26-29`, `portal/leave.ts:109-110`, `portal/admin/merch.ts:87-88`).
- **R2 deletes** are fenced to the tenant's own prefix and refuse a bucket-wide prefix (`lib/r2.ts:94-99, 136-140`).
- **CDN proxy** refuses path traversal, forwards validators and range headers, streams the body, and does not cache or leak origin errors (`cdn/api/asset.ts:44-62, 74`).
- **Deploy safety rails.** Tests, drift check and browser journeys gate the deploy; production requires the same backend already on staging; a pre-migration snapshot is taken; the new image is smoke-tested before the serving container is touched; rollback is by pinned sha; deploys to the shared host are serialised (`.github/workflows/deploy-be.yml:487-540, 748-768, 782-833`). The smoke test's side effect is J-01.
- **`uncaughtException`** logs and exits through the shutdown path (`server.ts:68-71`); `SIGTERM` / `SIGINT` are handled and the pool is closed (`server.ts:57-58`, `db/index.ts:247`).
- **Maintenance mode** exempts webhooks and health, so payments land while it is on (`app.ts:82-90`).

---

## Cross-slice notes (for the other auditors)

- **DB pool.** `postgres(url)` with defaults (`db/index.ts:27`): 10 connections, no `idle_in_transaction_session_timeout`, no `statement_timeout`. M-02, W-01, W-03, O-01, J-03, J-06 and S-03 are all the same ceiling.
- **Security.** Logo fetch SSRF (`receipts/logo.ts:30, 48`); public bucket holding supporting documents with year-long immutable cache headers (`lib/r2.ts:44-53`, `cdn/api/asset.ts:20`); `X-Forwarded-For` trust for every limiter key.
- **Client API.** Whether booking paths check `expires_at` as well as `active` decides how much J-07 matters.
- **Frontends.** Avatar sizes (O-03); whether any server-side fetch to `/public/*` other than the slug lookup lands in the `'global'` limiter bucket (S-01).

## Suggested order

1. M-01 (paid Resend plan, configurable quotas): a config change that removes a hard stop.
2. S-01 (limiter keyed per user, after auth): small code change, removes 429s at the busiest moment.
3. J-01 + J-05 (jobs off in the smoke container, `noOverlap`, advisory lock) and J-02/J-03 (reminder marker + after-commit): small, removes duplicate and lost mail.
4. J-04 + S-03 (fatal on failed registration, liveness healthcheck).
5. The outbox: one table-driven worker loop for mail (M-02, M-03) and Stripe events (W-01, W-05). The largest item and the one that takes vendor latency off the request path and off the pool.
6. O-01 (scope the 60-minute timeout, body before transaction, Stripe outside the transaction), O-02 (CDN `s-maxage`), W-02, W-04.
7. S-02 / S-06 / S-07 (compiled image, graceful drain, shared state) as the groundwork for a second instance.
