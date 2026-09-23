# Booking System

A **multi-tenant** booking & management platform for yoga studios. One deployment of each app serves every studio; a studio is a **Tenant** — a row in `tenants`, never its own infrastructure — and every domain row carries a `tenant_id`.

**No studio is named anywhere in this repo, and none may be.** A studio's name, premises, branding and copy are rows it owns, written when it is created or restored through the super portal — not constants, not seed data, not comments. The only studios that appear in the code are the two invented fixtures the isolation tests run against (`northwind` and `acme`, in `be/src/db/seed/provisioning.ts`), which exist so that a missing `WHERE tenant_id = ?` has something to be visibly wrong about. If you are about to write a real studio's name into a file, the thing you actually want is a `tenants` / `tenant_settings` row.

## Tenancy

- **Shared schema, row scoping, Row-Level Security.** One Postgres database. `tenant_id` on all 57 domain tables, `NOT NULL` with no default. One more table carries it nullable: the sign-in audit log `auth_events`, whose null rows are the super portal's (`PLATFORM_ROWS` in `be/src/db/roles.ts`). Postgres policies (migration `0033`) are the fail-closed backstop for a query that forgets to scope. See `docs/adr/0002-shared-schema-row-level-security.md`.
- **The app must not connect as the table owner.** Postgres exempts superusers and owners from RLS, so the server connects as the non-owning `booking_app` role via `DATABASE_APP_URL`. `DATABASE_URL` (the owner) is for migrations and seeds only.
- **Tenant context is transaction-local.** `withTenant` (`be/src/db/index.ts`) sets `app.tenant_id` per transaction — session scope would ride a pooled connection into the next request.
- **The API's own hostname carries no Tenant.** The frontends read the slug from their hostname and send `X-Tenant-Slug`; the backend corroborates it against the browser `Origin` or the Tenant claim on the caller's session. See `docs/md/spec-tenant-resolution.md`.
- Domain glossary for these terms: `be/CONTEXT.md` § Tenancy. Plan and status: `docs/md/multi-tenancy-plan.md`.

## Structure

| Dir | What | Stack |
|---|---|---|
| `fe-client/` | Member-facing booking app, port 3000, hits `/api/v1/{me,public}/*` | Next.js App Router + Tailwind + shadcn/ui |
| `fe-portal/` | Staff app (admin + instructor), port 3001, hits `/api/v1/portal/{admin,instructor}/*` | same |
| `be/` | Backend | Hono (NOT Express) + Drizzle + Postgres + Better Auth (self-hosted, 3 pools) + Stripe + R2 + Resend (mail) |
| `cdn/` | Edge proxy fronting the R2 bucket at `cdn.reservetoday.app` | Vercel edge function (no framework) |
| `docs/md/` | Canonical specs | — |

BE layout: routes split by audience (`routes/portal/{admin,instructor}/`, `routes/client/`, `routes/public/`, `routes/webhooks/`), services by feature (`services/<feature>/`). Background jobs: `node-cron`.

## Spec docs (`docs/md/`)

`prd.md` (product requirements) · `fe-client-features.md` (source of truth for fe-client) · `admin-restructure.md` (source of truth for fe-portal) · `backend-architecture.md` (BE spine — stack, folders, DB schema, integrations, jobs) · `be-portal.md` / `be-client.md` (route surfaces) · `deployment.md` (Vercel + VPS deploy, envs, CORS, auth, CI settings).

## Conventions

- Keep `fe-client/`, `fe-portal/`, and `be/` fully decoupled — no shared dependencies.
- No business logic in route files — routes do `auth → zod parse → call service → format response`. Domain rules live in `services/*` so admin and client paths can't drift.
- Schema changes go through PR review by both backend devs (single `drizzle.config.ts`, single migration history).
- Do not commit `.env` files or secrets. Adding/renaming a BE env var means updating `.github/workflows/deploy-be.yml`, `be/.env.example`, and `be/src/env.ts` together (see `docs/md/deployment.md`); a new `NEXT_PUBLIC_*` also has to be set in the Vercel dashboard.
- Docs go in `docs/md/` (markdown) or `docs/html/` (static). Two exceptions: the **domain glossary** for a context lives at `<context>/CONTEXT.md` (indexed by root `CONTEXT-MAP.md`), and **ADRs** live at `<context>/docs/adr/NNNN-slug.md` (root `docs/adr/` if the decision spans all three apps).
- **Commit messages**: no `Co-Authored-By: Claude …` trailers, no `🤖 Generated with Claude Code` lines.

## Testing

**Tests verify behaviour.** A failing test means the code is wrong until a human says the spec changed. So:

- **Never special-case inputs.** No branch that recognises a test's values (`if (email === 'member@northwind.test')`), no hard-coded return shaped to one assertion. Fix the general behaviour.
- **Never weaken a test to make it pass.** No skipping, loosening an assertion, rewriting an expected value to match what the code does, catching the error it checks for, or deleting the test. If you believe a test is wrong, stop and say so.

Guardrails back this up (`docs/md/test-guardrails.md`): a hook refuses edits to committed test files unless a human lists them in `.claude/test-edits.allow`; stopping runs the suites the session touched; CI fails on a skipped test and on a PR with fewer tests than its base.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `Blueprint-Agency/booking-system`, driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, used verbatim: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context — root `CONTEXT-MAP.md` pointing at a `CONTEXT.md` per app (`fe-client/`, `fe-portal/`, `be/`). See `docs/agents/domain.md`.
