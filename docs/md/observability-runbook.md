# Observability Runbook

**For the developer on call at 2am.** This page is the whole of what you need to
answer "is it broken, where, and what do I do first" without reading the
codebase. Concepts — what logs, metrics and traces *are*, and how the app's error
handling is put together — are in
[`observability-and-error-handling.md`](./observability-and-error-handling.md).
How the code got here is [#124](https://github.com/Blueprint-Agency/booking-system/issues/124).

> **The tenancy rule, in logs as everywhere else: Tenant ids, never names or
> slugs.** Every log line, alert label, dashboard panel and screenshot names a
> Tenant by its uuid. A studio's name must not reach Grafana, Discord, or a
> ticket. If you need to know which studio a `tenantId` is, look the row up in
> the database yourself — don't paste the answer back.

---

## 1. Where the alert lands, and who watches it

| | |
|---|---|
| Channel | the **app Discord channel**, via the `discord-booking` contact point |
| Who watches | the two backend developers. There is no rota, no phone, no paging — an alert at 2am is seen at 2am only if someone is awake. |
| Routing | every booking rule carries the label `app=booking`; an `app=booking` route sits **above** the severity routes in the notification policy tree, and first match wins |
| Not in that channel | **`Public endpoint failing`** (the API-down rule) goes to the **infra** Discord channel, because it is the shared `endpoint-down` rule and carries no `app` label. Deliberate for now — if the API is down and the app channel is quiet, look at the infra channel. |

Contact points and the policy tree live in the infrastructure repo
([`docs/grafana-organization.md`](https://github.com/Blueprint-Agency/infrastructure/blob/main/docs/grafana-organization.md)).

## 2. Reaching the host

Both booking stacks run on **bpvps2**, over Tailscale:

```bash
ssh bp-bpvps2
cd /root/stacks/booking-staging       # or /root/stacks/booking-prod
```

The compose file itself lives in the infrastructure repo at
`vps/bpvps2/stacks/booking/docker-compose.yml` — edit it there, never on the box.

## 3. Where to look

Grafana stack: **https://blueprintdigital.grafana.net**

### Dashboards
- **Hosts** (per-container CPU / memory / disk) — https://blueprintdigital.grafana.net/d/bp-hosts/hosts
- **Endpoints** (synthetic checks) — https://blueprintdigital.grafana.net/d/bp-endpoints/endpoints

### Logs — Explore, datasource `grafanacloud-logs`

| What | Query |
|---|---|
| Backend, staging | `{container="booking-be-staging"}` |
| Backend, production | `{container="booking-be-prod"}` |
| Errors only (both envs; `level` is a stream label) | `{compose_service="booking-be", level="error"}` |
| Stripe webhook failures | `{compose_service="booking-be", level="error"} \| json \| webhook="stripe"` |
| One request, end to end | `{compose_service="booking-be"} \| json \| requestId="<id>"` |
| One Tenant | `{compose_service="booking-be"} \| json \| tenantId="<uuid>"` |
| Cron heartbeat for a job | `{compose_service="booking-be"} \|= "cron job ok" \| json \| job="expirePackages"` |
| Browser exceptions (Faro) — **there is no `app` label; the app's name lives in the line** | `{kind="exception"} \| logfmt \| app_name="fe-client"` |
| All browser telemetry for one app | `{kind=~"exception\|event\|measurement\|log"} \| logfmt \| app_name="fe-portal"` |
| Outbound vendor calls that did not succeed (these are `warn`, not `error`) | `{compose_service="booking-be"} \|= "outbound call" \| json \| outcome != "ok"` |

### Alerting
- Rules — https://blueprintdigital.grafana.net/alerting/list (folder `Apps`, groups `booking` and `booking-jobs`)
- Contact points: `discord` (infra) and `discord-booking` (this app)

### Synthetic checks
Six names, all probing a public URL: both APIs on `/health` (it answers **503**
when the database is unreachable, so a dead database turns the check red), and
the four frontend hostnames `www[.dev].reservetoday.app` and
`admin.portal[.dev].reservetoday.app`. Slug-free on purpose — `www` and `admin`
are reserved labels no Tenant can hold.

### Frontend Observability (Faro)
Two apps, named by the code in each frontend's `src/lib/telemetry.ts`:
**`fe-client`** and **`fe-portal`**. Both environments share an app and are split
by the `environment` attribute, which the app sets from `NEXT_PUBLIC_APP_ENV`.
Events carry `user_id` and `user_attr_tenantId`.

**How Faro data is actually labelled in Loki**, which is not how the rest of this
page's queries work and is the thing that wastes ten minutes at 2am. The stream
labels are `kind` (`exception` \| `event` \| `measurement` \| `log`),
`app_id` (a **number** Grafana assigns, not a name), `app_key` and
`deployment_environment`. There is **no `app` label**, and no `container` or
`compose_service` — these lines never touched a container. The app's name is
`app_name` **inside the line**, so it is reached with `| logfmt` and not from the
selector. Start every Faro query from `kind`, filter by `app_name` after it.

#### Which Faro app an event belongs to
`app_id` is a number Grafana assigns per Faro app; it is what appears in Loki,
and nothing in it says which frontend or which environment it is. The stable
identifier a human can check is the **collector key** — the 32-hex segment at
the end of `NEXT_PUBLIC_FARO_COLLECTOR_URL`, which is what the browser posts to
and therefore what decides the `app_id`.

| `app_id` | Collector key (prefix) | App | Vercel project | Status |
|---|---|---|---|---|
| **`1340`** | `a2b45d5f…` | `fe-client` | `booking-system` | **current** — set in Production and Preview |
| **`1339`** | `9c8d4d74…` | `fe-portal` | `booking-system-admin` | **current** — set in Production and Preview |
| `1337` | `38ced930…` | `fe-client` | — | superseded key, still receiving |
| `1338` | `3553241163…` | `fe-portal` | — | superseded key, still receiving |

Both environments post to the **current** app for their frontend and are told
apart by `deployment_environment`, which comes from `NEXT_PUBLIC_APP_ENV`.

> **The two superseded apps are not dead, and that is the trap.** Measured
> 2026-09-20: all four ids received events within the same 24 hours (1337: 66,
> 1338: 24, 1339: 256, 1340: 269). The collector key is a `NEXT_PUBLIC_*`, so it
> is **baked in at build time** — every Vercel Preview deployment built before
> the key changed still posts to the old app, and anything still exercising those
> URLs (the E2E suite, an open tab) keeps them alive. So a Faro app receiving
> data is **not** evidence that it is the one your current build uses. Check the
> collector key, not the traffic. The ids drain on their own as old preview
> deployments age out.

To map an `app_id` that is not in the table, open the Faro app in Grafana
(Frontend Observability → Settings) and compare its collector URL.

> **Config verified on 2026-09-20**, from the Vercel API and the shipped
> bundles. Both production projects carry `NEXT_PUBLIC_FARO_COLLECTOR_URL` and
> `NEXT_PUBLIC_APP_ENV=production` in the **Production** scope, and both were
> redeployed after those were set — the JS served by `www.reservetoday.app` and
> `admin.portal.reservetoday.app` contains the collector URL and
> `environment:"production"`. A silent production query is therefore no longer
> explained by a missing env var.
>
> Still open: **no production event has ever arrived.** Every event in Loki is
> `deployment_environment=staging`, and the config above means the only thing
> left is that nobody has loaded a production page in a real browser since the
> redeploy — the E2E suite drives staging only. Loading
> `www.reservetoday.app` and `admin.portal.reservetoday.app` once is what proves
> it end to end. One stray event names an app
> `reservetoday-client`, which no current code emits — a stale tab, and proof
> the app name is baked in at build time. Tracked in the issues linked from
> [#124](https://github.com/Blueprint-Agency/booking-system/issues/124).

> **No browser events is usually a missing env var, not a healthy frontend.**
> Faro is a deliberate no-op unless `NEXT_PUBLIC_FARO_COLLECTOR_URL` is set — and
> it is a `NEXT_PUBLIC_*`, so it is baked in **at build time**: setting it in
> Vercel does nothing until that project is redeployed. Same for
> `NEXT_PUBLIC_APP_ENV`, which is what splits staging from production. Check both
> in the Vercel project (Production **and** Preview scopes) before concluding the
> frontend is quiet.

### Database Observability
Instances `booking-staging` and `booking-prod`, scraped by the `db-observability`
stack on bpvps2. Explain plans are **off**: the `db-o11y` role holds `pg_monitor`
and nothing else, so it cannot read booking data.

## 4. The log fields, and what each means

Every backend line is JSON and carries `service`, `level`, `time`, `msg`, plus
whatever the request or job put in the **log context** (`be/src/shared/logger.ts`).
The names are fixed — alert rules key on them.

| Field | Means | Written by |
|---|---|---|
| `requestId` | this request's id, also returned in the `x-request-id` header and in the `requestId` of any 500 body — the one thing a user or support can quote | `middleware/request-id.ts` |
| `tenantId` | the resolved Tenant's **uuid**. Never a slug, never a name. | `middleware/tenant.ts`, and the per-Tenant job wrapper |
| `actorId` | the Better Auth user id of the signed-in caller. Under impersonation, the **member's**. | the three auth middlewares |
| `pool` | which auth pool that user is in: `client` \| `staff` \| `platform` | the three auth middlewares |
| `impersonatedBy` | the acting Admin's Better Auth user id, present only under an impersonation grant | `middleware/client-impersonation.ts` |
| `job` | the cron job's name (`expirePackages`, `sendLapsingAlerts`, …) | the wrappers in `jobs/index.ts` |
| `webhook` | the vendor a webhook came from: `stripe` \| `resend` | the two webhook routes |
| `vendor` | which vendor an **outbound** call went to: `stripe` \| `storage` \| `resend` | `lib/outbound.ts` |
| `op` | which operation on that vendor — `checkout.sessions.create`, `refunds.create`, `putObject`, `emails.send` | `lib/outbound.ts` |
| `ms` | how long it took, milliseconds. On an access line, the whole request; on an outbound line, that one call; on a cron line, the whole run. | access log, `lib/outbound.ts`, `jobs/index.ts` |
| `outcome` | how it ended. Outbound: `ok` \| `timeout` \| `error`. Cron: `ok` \| `error`. | `lib/outbound.ts`, `jobs/index.ts` |

Three line shapes worth recognising:

- **`request`** — one `info` per request, whatever the status, with
  `method`/`path`/`status`/`ms`. `/health` is not access-logged.
- **`outbound call`** — one line per vendor call. `info` when `outcome=ok`,
  **`warn` for every other outcome** — timeout and error alike. A `timeout`
  means the vendor blew its deadline (Stripe and storage 8s, Resend 5s) and the
  caller got a retryable 503.
  **Read this twice at 2am:** a failing vendor writes no `level=error` line, so
  it does not show up in the "Errors only" query and **does not trip the
  error-rate alert**. "Stripe is down" looks like silence here. If members are
  reporting failed payments or missing mail and the error rate is flat, query
  the warns directly:
  `{compose_service="booking-be"} |= "outbound call" | json | outcome != "ok"`.
- **`cron job ok`** — one `info` with `job`, `outcome=ok` and `ms` per successful
  scheduler run — every tick, whether or not any Tenant was due. This is the
  heartbeat the job-stale rules count, so it proves the scheduler is alive, not
  that work happened. A failure is `cron job failed` at `error`; a failure
  confined to one studio is `cron job failed for tenant`, and carries that
  `tenantId`.

A typed, expected error (class full, card declined) is **answered, not logged** —
so "no error line" does not mean "no failure". Only unhandled errors produce an
`error` line, and exactly one each, with the stack and the ids above.

## 5. The alert rules, and the first thing to check

| Rule | What it means | Check first |
|---|---|---|
| **Booking backend error rate** — `count_over_time({compose_service="booking-be", level="error"}[5m]) > 20` | more unhandled errors than normal in five minutes | Open `{compose_service="booking-be", level="error"}` in Explore for that window. Take one line's `requestId` and pull the whole request. Usually one route, one deploy: check whether the sha changed (`grep IMAGE_TAG .env` in the stack) and whether every error shares a `tenantId` (one studio's data) or spreads across all (the code). |
| **Booking Stripe webhook failing** — any `level=error` with `webhook=stripe` | a webhook Stripe signed got as far as our handler and the handler threw. Stripe will retry, so this is not yet lost money — but it will stop retrying. | `{compose_service="booking-be", level="error"} \| json \| webhook="stripe"`. Read the error: `client_not_found` / `tenant` errors mean the event routed to nothing (see **Tenant routing** in `be/CONTEXT.md`); anything else is a handler bug. Cross-check the event in the Stripe dashboard before replaying. A `warn` with `webhook=stripe` instead is a **refused signature** — that is someone sending us junk, or a rotated signing secret. |
| **Public endpoint failing** — a synthetic check fails ≥2 runs in a row | the URL did not answer from Grafana's probes. For an API name, `/health` returned non-200 — which includes **503, the database being unreachable**. Lands in the **infra** channel. | `ssh bp-bpvps2`, `docker compose ps` in the stack. Container down → `docker compose logs`. Container **up and healthy but the check is red** → it is Postgres, not the app: check the `postgres` container and Database Observability. Frontend name red → Vercel status and the Vercel deployment, not the box. |
| **Booking job `<job>` not running** — zero `outcome=ok` lines for that `job` in 25h (no-data also fires) | a daily cron job has not reported a successful run in over a day. Eight of these: four daily jobs × two environments. | `{compose_service="booking-be"} \|= "cron job ok" \| json \| job="<name>"` — is it *late* or *absent*? Absent: is the container up, and has it been up for >25h (`docker compose ps`)? Then look for `cron job failed` / `cron job failed for tenant` with the same `job`. Note what this rule really proves: the daily jobs ride a shared 15-minute grid and write `cron job ok` on **every tick**, whether or not a Tenant was due, so silence means *the scheduler stopped*, not "no studio needed it". The hour each job acts on is that **Tenant's own local hour** from `tenants.timezone` — `expirePackages` 01:00, `flagExpiredWaivers` 02:00, `sendLapsingAlerts` / `sendExpiredNotifications` 08:00 — so a job doing nothing for a given studio is normal for 23 of 24 ticks. |

Two known blind spots, both ticketed, both worth remembering at 2am:

- **Nothing alerts when the agents stop shipping.** If the Grafana Cloud push
  token is revoked or Alloy dies, every rule goes quiet instead of firing.
  Silence is not health — glance at the Hosts dashboard for recent data.
  ([infrastructure#40](https://github.com/Blueprint-Agency/infrastructure/issues/40))
- **A stack whose files changed in a *failed* deploy is never re-synced by later
  deploys**, so a config fix can sit in the infra repo unapplied while the rules
  that depend on it match nothing.
  ([infrastructure#39](https://github.com/Blueprint-Agency/infrastructure/issues/39))

## 6. The first five commands

```bash
# 1. Is it running? — both stacks are on bpvps2
ssh bp-bpvps2
cd /root/stacks/booking-staging            # booking-prod for production
docker compose ps                          # booking-be should be "healthy"

# 2. What is it saying right now?
docker compose logs -f --tail=200 booking-be

# 3. Find one request by id, in Grafana Explore (datasource grafanacloud-logs)
#    A user or a 500 body gives you the id; this gives you every line it wrote.
{compose_service="booking-be"} | json | requestId="<the id>"
#    Same thing on the box, without Grafana:
docker compose logs booking-be | grep '<the id>'

# 4. Roll the code back — swap the two image tags, then bring the stack up.
#    Full explanation: docs/md/deployment.md § Rolling back the backend
grep IMAGE_TAG .env                        # IMAGE_TAG=<bad sha>  PREVIOUS_IMAGE_TAG=<good sha>
sed -i -e 's/^IMAGE_TAG=/SWAP_IMAGE_TAG=/' -e 's/^PREVIOUS_IMAGE_TAG=/IMAGE_TAG=/' \
       -e 's/^SWAP_IMAGE_TAG=/PREVIOUS_IMAGE_TAG=/' .env
docker compose up -d && docker compose ps

# 5. Restore the database — only when a migration broke data, not for a bad deploy.
#    Full explanation: the infra repo's docs/backup-restore.md
docker exec backup restic snapshots --tag booking-staging     # pick the one before the bad deploy
docker exec backup /app/bin/restore-live.sh booking-staging <id> --confirm booking-staging
```

**Step 4 moves the code, never the data.** The old image runs against the
database the bad deploy already migrated, which is safe only because migrations
only add. If the migration itself broke data, step 5 is the way back, not step 4.

Reference: [`deployment.md`](./deployment.md) for the rollback and the
pre-migration snapshot;
[`infrastructure/docs/backup-restore.md`](https://github.com/Blueprint-Agency/infrastructure/blob/main/docs/backup-restore.md)
for restore.

## 7. Limits that will bite

| Thing | Free tier | Where we are |
|---|---|---|
| Loki logs | 50 GB / 14 days retention | fine; `logging:` caps (json-file, 10m × 3) on every booking service keep the host's own disk bounded |
| Metric series | 10k | fine |
| Faro sessions | 50k / month | fine |
| Synthetic check executions | **100k / month**, counted per probe per run | **over.** The full set is ~1.43M/month at 3 probes × 60s, hidden by a Pro trial ending **2026-09-27**. A shape that fits: the two `/health` checks every 2 minutes, the other names every 15, one probe each (~80k). Needs a decision before that date. |
