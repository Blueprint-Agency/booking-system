# Error Handling, Logging & Observability — Guide + Implementation

A plain-English reference for how this app catches failures, records what
happened, and (later) watches its own health — plus exactly what was built in
Phase 1 and what's still ahead.

---

## 1. The mental model: three questions a running app must answer

Your backend runs on a Hostinger VPS and your frontends on Vercel — places you
can't watch directly. A healthy app answers three questions on its own:

1. **"Did something break?"** → error handling + error monitoring
2. **"What was happening when it broke?"** → logging
3. **"Is the system healthy / fast?"** → observability (metrics + traces)

## 2. The concepts

- **Error handling** — code that catches failures so the app doesn't crash and
  users don't see a blank screen. Two kinds:
  - *Operational* errors (expected: class full, card declined, network blip) →
    handle gracefully, show a helpful message.
  - *Programmer* errors (bugs: `undefined.id`) → crash fast, log, let the
    process restart (Docker does this), then fix.
- **Logging** — the app's diary. *Structured* (JSON) logs can be searched/
  filtered by machine; *plain* logs can't. We use structured logs (Pino).
- **Observability** — being able to investigate *why* the system behaves as it
  does, built on **three pillars**:
  - **Logs** — individual events ("what happened")
  - **Metrics** — numbers over time ("how much / how fast": req/s, error rate, p95 latency, CPU/RAM)
  - **Traces** — one request's journey ("where the time went")
- **Error monitoring** — a specialized slice that would capture the crash,
  stack trace, affected users and frequency, and alert you. Not currently
  used; see § 5 History.
- **Product analytics** (PostHog) — a *separate* category: user behaviour
  (booking funnel, drop-off), not system health.

## 3. App-level vs server-level

Observability spans **both**, combined in one view:

| | App-level | Server / infra-level |
|---|---|---|
| Question | "Is my code behaving?" | "Is the machine healthy?" |
| Measures | req rate, error rate, latency, traces | CPU, RAM, disk, container/DB health |
| Reported by | the app (Pino, SDK) | an agent installed on the server |

- **Hostinger VPS (backend):** you own the box → do **both** levels.
- **Vercel (frontends):** managed/serverless → **app-level only** (no server of
  yours to monitor; Vercel shows its own platform metrics).

## 4. What a complete setup has — and where you look

| Layer | Tool (free) | Catches | Where you look |
|---|---|---|---|
| In-code error handling | `AppError` + `errorBoundary` + `safeJob` + `error.tsx` | the failure itself | clean JSON to client; user sees toast / fallback page |
| Structured logs | Pino → stdout | every event w/ requestId | `docker compose logs -f` on the VPS |
| Backend error monitoring | none (removed — see § 5 History) | — | logs only |
| Frontend error monitoring | none (removed — see § 5 History) | — | logs only; user sees `error.tsx` |
| Metrics | New Relic / Grafana | req/s, error rate, p95, CPU | platform dashboard + alerts |
| Traces | New Relic / Grafana (OTel) | one request's timing | trace waterfall |
| Uptime | UptimeRobot / Better Stack | "is it up at all?" | uptime dashboard + alert |
| Product analytics | PostHog (optional) | booking funnel, drop-off | PostHog dashboard |

---

## 5. Phase 1 — what was implemented (foundation: errors + logs)

### Backend (`be/`)
- **Structured logging** — `src/shared/logger.ts` (Pino). JSON to stdout in prod
  (Docker captures it); pretty-printed in dev. Set `LOG_LEVEL` to override.
- **Log context (#162)** — every line written during a request carries
  `requestId`, `tenantId` once resolved and `actorId` + `pool` once
  authenticated (`impersonatedBy` under an impersonation grant), without the
  caller passing anything: an `AsyncLocalStorage` store in `src/shared/logger.ts`
  read by Pino's `mixin`. Webhook lines add `webhook`, cron lines `job`. The
  field names are fixed (alert rules key on them) and listed in that file's header.
- **Access log** — `src/middleware/logger.ts` logs one `info` line per request
  (method/path/status/ms), whatever the status.
- **Central error handler** — `src/middleware/error.ts` writes exactly one
  `error` line per unknown error (with its stack and the context ids) and
  returns the `requestId` in the 500 body so a user/support can quote it to find
  the log. Typed errors are answered, not logged. A refused webhook signature is
  one `warn` line.
- **Cron safety** — `src/jobs/index.ts` wraps every job in `safeJob()`: a thrown
  error is logged, never an unhandled crash, and a run that finished writes one
  `info` line with `outcome=ok`. (Jobs remain dormant —
  `registerJobs` is still not called — but are now safe for when they're enabled.)
- **Process safety nets + graceful shutdown** — `src/server.ts` handles
  `unhandledRejection` / `uncaughtException` and drains on `SIGTERM`/`SIGINT`.
- **Console cleanup** — runtime `console.*` across services/middleware/webhooks
  replaced with the structured logger (seed/migrate CLI scripts keep `console`).

### Frontends (`fe-client/`, `fe-portal/`)
- **Error boundaries** — `app/error.tsx`, `app/global-error.tsx`, and
  `app/not-found.tsx` in both apps (on-brand fallback UI instead of a blank page).
- **Toast infra** — `sonner` + `<Toaster>` added to `fe-client` (fe-portal
  already had it).
- **Error sink** — `src/lib/report-error.ts` in both apps: the single place
  client errors are reported (console).
- **De-silenced catches** — fe-client's swallowed data-load/checkout catches now
  route through `report-error.ts` instead of being dropped.

### Verification
- `be`: `npx tsc --noEmit` ✅, Pino/pino-pretty boot smoke test ✅
- `fe-client` / `fe-portal`: `npx tsc --noEmit` ✅ and `next build` ✅

## 5b. History — Sentry (removed)

Sentry (`@sentry/node`, `@sentry/nextjs`) was wired into all three apps as
Phase 1's error-monitoring layer, gated on `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`
so it stayed a no-op unless configured. It has since been removed entirely —
the SDK, the DSN env vars, `be/src/instrument.ts`,
`fe-*/src/instrumentation*.ts`, `fe-*/src/sentry.*.config.ts`, and the
`withSentryConfig` build wrapper are all gone from the repo. `report-error.ts`
in each app now only logs to the console; unknown backend errors are only
logged via Pino. There is currently no error-monitoring dashboard or alerting
— that gap is the same one Phase 2 below (or a re-adoption of Sentry/GlitchTip)
would close.

## 6. Next step
- **Uptime monitor** — add the app URLs to UptimeRobot/Better Stack (5 min, free).

## 7. Phase 2 (later — observability platform)
- Install **one agent** on the VPS (New Relic free tier *or* Grafana Cloud) for
  metrics + traces + host/DB health. New Relic has a first-class Pino forwarder
  (`@newrelic/pino-enricher`) that slots onto the logger above.
- Note: this is a single modular monolith, so traces add the least value — logs +
  errors + a few metrics already cover the vast majority of incidents.

## 8. Phase 3 (optional — product analytics)
- **PostHog** for the booking funnel / feature usage. Separate from system health.
