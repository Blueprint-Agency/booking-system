# Yoga Sadhana Booking System

Dedicated booking & management platform for **Yoga Sadhana** (NOT multi-tenant SaaS). Two studio locations: Breadtalk IHQ (Tai Seng) + Outram Park.

## Structure

| Dir | What | Stack |
|---|---|---|
| `fe-client/` | Member-facing booking app, port 3000, hits `/api/v1/{me,public}/*` | Next.js App Router + Tailwind + shadcn/ui |
| `fe-portal/` | Staff app (admin + instructor), port 3001, hits `/api/v1/portal/{admin,instructor}/*` | same |
| `be/` | Backend | Hono (NOT Express) + Drizzle + Postgres + Clerk (2 apps) + Stripe + R2 + Nodemailer SMTP |
| `docs/md/` | Canonical specs | — |

BE layout: routes split by audience (`routes/portal/{admin,instructor}/`, `routes/client/`, `routes/public/`, `routes/webhooks/`), services by feature (`services/<feature>/`). Background jobs: `node-cron`.

## Spec docs (`docs/md/`)

`prd.md` (product requirements) · `fe-client-features.md` (source of truth for fe-client) · `admin-restructure.md` (source of truth for fe-portal) · `backend-architecture.md` (BE spine — stack, folders, DB schema, integrations, jobs) · `be-portal.md` / `be-client.md` (route surfaces) · `deployment.md` (Vercel + VPS deploy, envs, CORS, Clerk apps, CI settings).

## Conventions

- Keep `fe-client/`, `fe-portal/`, and `be/` fully decoupled — no shared dependencies.
- No business logic in route files — routes do `auth → zod parse → call service → format response`. Domain rules live in `services/*` so admin and client paths can't drift.
- Schema changes go through PR review by both backend devs (single `drizzle.config.ts`, single migration history).
- Do not commit `.env` files or secrets. Adding/renaming a BE env var means updating `.github/workflows/deploy-be.yml`, `be/.env.example`, and `be/src/env.ts` together (see `docs/md/deployment.md`); a new `NEXT_PUBLIC_*` also has to be set in the Vercel dashboard.
- Docs go in `docs/md/` (markdown) or `docs/html/` (static). Two exceptions: the **domain glossary** for a context lives at `<context>/CONTEXT.md` (indexed by root `CONTEXT-MAP.md`), and **ADRs** live at `<context>/docs/adr/NNNN-slug.md` (root `docs/adr/` if the decision spans all three apps).
- **Commit messages**: no `Co-Authored-By: Claude …` trailers, no `🤖 Generated with Claude Code` lines.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `Blueprint-Agency/booking-system`, driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, used verbatim: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context — root `CONTEXT-MAP.md` pointing at a `CONTEXT.md` per app (`fe-client/`, `fe-portal/`, `be/`). See `docs/agents/domain.md`.
