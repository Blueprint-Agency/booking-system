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
- **Error monitoring** (Sentry/GlitchTip) — a specialized slice that captures the
  crash, stack trace, affected users, frequency, and alerts you.
- **Product analytics** (PostHog) — a *separate* category: user behaviour
  (booking funnel, drop-off), not system health.

## 3. App-level vs server-level

Observability spans **both**, combined in one view:

| | App-level | Server / infra-level |
|---|---|---|
| Question | "Is my code behaving?" | "Is the machine healthy?" |
| Measures | req rate, error rate, latency, traces | CPU, RAM, disk, container/DB health |
| Reported by | the app (Pino, Sentry, SDK) | an agent installed on the server |

- **Hostinger VPS (backend):** you own the box → do **both** levels.
- **Vercel (frontends):** managed/serverless → **app-level only** (no server of
  yours to monitor; Vercel shows its own platform metrics).

## 4. What a complete setup has — and where you look

| Layer | Tool (free) | Catches | Where you look |
|---|---|---|---|
| In-code error handling | `AppError` + `errorBoundary` + `safeJob` + `error.tsx` | the failure itself | clean JSON to client; user sees toast / fallback page |
| Structured logs | Pino → stdout | every event w/ requestId | `docker compose logs -f` on the VPS |
| Backend error monitoring | Sentry (`@sentry/node`) | exceptions + stack + frequency | Sentry dashboard + alerts |
| Frontend error monitoring | Sentry (`@sentry/nextjs`) | browser/render crashes | Sentry dashboard; user sees `error.tsx` |
| Metrics | New Relic / Grafana | req/s, error rate, p95, CPU | platform dashboard + alerts |
| Traces | New Relic / Grafana (OTel) | one request's timing | trace waterfall |
| Uptime | UptimeRobot / Better Stack | "is it up at all?" | uptime dashboard + alert |
| Product analytics | PostHog (optional) | booking funnel, drop-off | PostHog dashboard |

---

## 5. Phase 1 — what was implemented (foundation: errors + logs)

### Backend (`be/`)
- **Structured logging** — `src/shared/logger.ts` (Pino). JSON to stdout in prod
  (Docker captures it); pretty-printed in dev. Set `LOG_LEVEL` to override.
- **Per-request logger + access log** — `src/middleware/logger.ts` attaches a
  child logger tagged with `requestId` to every request (`c.get('log')`) and
  logs one line per request (method/path/status/ms).
- **Enriched central error handler** — `src/middleware/error.ts` now logs
  unknown errors with full context, reports them to Sentry, and returns the
  `requestId` in the 500 body so a user/support can quote it to find the log.
- **Cron safety** — `src/jobs/index.ts` wraps every job in `safeJob()`: a thrown
  error is logged + reported, never an unhandled crash. (Jobs remain dormant —
  `registerJobs` is still not called — but are now safe for when they're enabled.)
- **Process safety nets + graceful shutdown** — `src/server.ts` handles
  `unhandledRejection` / `uncaughtException` and drains on `SIGTERM`/`SIGINT`.
- **Error monitoring (optional, gated)** — `src/instrument.ts` initialises Sentry
  only when `SENTRY_DSN` is set; otherwise a complete no-op. `@sentry/node`
  installed. Hosted Sentry was chosen; GlitchTip is a drop-in swap (same SDK,
  different DSN) if you later want to self-host.
- **Console cleanup** — runtime `console.*` across services/middleware/webhooks
  replaced with the structured logger (seed/migrate CLI scripts keep `console`).
- **Env wiring** — `SENTRY_DSN` added to `env.ts`, `.env.example`, and
  `deploy-be.yml` (set the `SENTRY_DSN` GitHub secret to enable in prod).

### Frontends (`fe-client/`, `fe-portal/`)
- **Error boundaries** — `app/error.tsx`, `app/global-error.tsx`, and
  `app/not-found.tsx` in both apps (on-brand fallback UI instead of a blank page).
- **Toast infra** — `sonner` + `<Toaster>` added to `fe-client` (fe-portal
  already had it).
- **Error sink** — `src/lib/report-error.ts` in both apps: the single place
  client errors are reported (console + Sentry).
- **Sentry SDK** — `@sentry/nextjs` wired in both apps (`instrumentation.ts`,
  `instrumentation-client.ts`, `sentry.server/edge.config.ts`, `withSentryConfig`),
  gated on `NEXT_PUBLIC_SENTRY_DSN`.
- **De-silenced catches** — fe-client's swallowed data-load/checkout catches now
  route through `report-error.ts` instead of being dropped.

### Verification
- `be`: `npx tsc --noEmit` ✅, Pino/pino-pretty boot smoke test ✅
- `fe-client` / `fe-portal`: `npx tsc --noEmit` ✅ and `next build` ✅

## 6. Remaining Phase 1 (next step)
- **Set the Sentry DSNs in deployment** (local dev is already wired):
  - Backend: add `SENTRY_DSN` as a **GitHub repo secret** (CI already passes it through).
  - Frontends: add `NEXT_PUBLIC_SENTRY_DSN` in each **Vercel project** (fe-client, fe-portal).
  - Local: `be/.env` (backend) + each frontend's `.env.local` already hold their DSNs.
- **Sentry org/projects:** `blueprint-agency-n7` → `node-hono` (be), plus the two
  Next.js projects (EU region). Errors-only for now (`tracesSampleRate: 0`).
- **Uptime monitor** — add the app URLs to UptimeRobot/Better Stack (5 min, free).

## 7. Phase 2 (later — observability platform)
- Install **one agent** on the VPS (New Relic free tier *or* Grafana Cloud) for
  metrics + traces + host/DB health. New Relic has a first-class Pino forwarder
  (`@newrelic/pino-enricher`) that slots onto the logger above.
- Note: this is a single modular monolith, so traces add the least value — logs +
  errors + a few metrics already cover the vast majority of incidents.

## 8. Phase 3 (optional — product analytics)
- **PostHog** for the booking funnel / feature usage. Separate from system health.
