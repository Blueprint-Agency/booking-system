# Error Handling, Logging & Observability — Guide + Implementation

A plain-English reference for how this app catches failures, records what
happened, and watches its own health. This page is the **concepts**. The
on-call page — URLs, field names, alert rules, commands — is
[`observability-runbook.md`](./observability-runbook.md).

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
- **Error monitoring** — a specialized slice that captures the crash, stack
  trace, affected users and frequency, and alerts you. Here it is not a separate
  product: the error lines in Loki plus the error-rate alert rule do the job.
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
| Structured logs | Pino → stdout → Alloy → Loki | every event w/ requestId | `docker compose logs -f` on the VPS; Grafana Explore |
| Backend error monitoring | Loki `level=error` + the error-rate alert rule | unhandled errors, w/ stack and ids | Grafana Explore + Discord |
| Frontend error monitoring | Grafana Faro | browser errors, w/ user and Tenant id | Faro app per frontend; user sees `error.tsx` |
| Metrics | Grafana Cloud (Alloy) | CPU / memory / disk per container, Postgres | Hosts dashboard + alerts |
| Traces | none | — | single modular monolith — logs cover it |
| Uptime | Grafana Synthetic Monitoring | "is it up at all?" | Endpoints dashboard + alert |
| Product analytics | PostHog (optional) | booking funnel, drop-off | PostHog dashboard |

---

## 5. What was built, and where to go when it breaks

All of it was delivered under
[#124](https://github.com/Blueprint-Agency/booking-system/issues/124) and its
seven tickets: structured Pino logs carrying request, Tenant and actor ids; one
`error` line per unhandled error with the `requestId` echoed in the 500 body;
the outbound-call wrapper with per-vendor deadlines; cron heartbeats; Grafana
Cloud for logs, metrics, host and database health; four alert rules into one
Discord channel; synthetic checks; and Grafana Faro on both frontends.

Sentry (`@sentry/node`, `@sentry/nextjs`) was the original error-monitoring
layer. It has been removed entirely — SDKs, DSN env vars, `be/src/instrument.ts`,
`fe-*/src/instrumentation*.ts`, `fe-*/src/sentry.*.config.ts` and the
`withSentryConfig` wrapper are all gone. Grafana Cloud replaced it.

**When something is broken, go to the runbook, not here:**
[`observability-runbook.md`](./observability-runbook.md) — which Discord channel
the alert landed in, how to reach the host, the Grafana dashboard and Loki URLs,
every log field name and what it means, what each of the four alert rules means
and what to check first, and the first five commands.
