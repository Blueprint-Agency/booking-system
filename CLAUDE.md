# Yoga Sadhana Booking System

Dedicated 2-app booking & management platform for **Yoga Sadhana** (NOT a multi-tenant SaaS). Two studio locations: Breadtalk IHQ (Tai Seng) + Outram Park.

## Project Structure

```
booking-system/
├── fe-client/   # Member-facing booking app (Next.js)
├── fe-portal/   # Staff app — admin + instructor views (Next.js, was fe-admin)
├── be/          # Backend — Hono + Drizzle + Postgres (in progress)
└── docs/
    ├── md/      # Markdown source — canonical specs
    └── html/    # Static HTML mockups (deployed to Vercel)
```

## Current Progress

- **fe-portal**: 🟢 wired to live BE — signup, middleware, role-aware admin pages, packages + workshops admin all hitting `/api/v1/portal/admin/*`.
- **fe-client**: 🟡 partially wired — packages catalog (incl. trial pass claim) and workshops list/detail hit live BE; classes, checkout (paid), account/* still pulling from mock-state.
- **be**: 🟡 schema + portal admin routes complete; client-facing read paths (packages, workshops, /me/packages) implemented; bookings, Stripe checkout, webhooks, refunds, and most account endpoints still stubbed at 501.

## Spec Docs (canonical, in `docs/md/`)

| File | What it covers |
|---|---|
| `prd.md` | Overall product requirements |
| `fe-client-features.md` | Client app behaviour & user journeys (source of truth for `fe-client`) |
| `admin-restructure.md` | Staff/portal app behaviour (source of truth for `fe-portal`) |
| `backend-architecture.md` | Backend spine — stack, folder structure, full DB schema, integrations, jobs, shared cross-cutting |
| `be-portal.md` | Portal backend surface — routes, endpoints, portal-driven flows |
| `be-client.md` | Client backend surface — routes, endpoints, client-driven flows |

## Apps

### `fe-client/` — Client app
- Next.js App Router + Tailwind + shadcn/ui. Runs on port 3000.
- Hits `/api/v1/me/*` and `/api/v1/public/*`.

### `fe-portal/` — Staff app (admin + instructor)
- Next.js App Router + Tailwind + shadcn/ui. Runs on port 3001.
- Was named `fe-admin/` — renamed because it serves both admin and instructor scopes (sharing one Clerk staff app).
- Hits `/api/v1/portal/admin/*` and `/api/v1/portal/instructor/*`.

### `be/` — Backend
- Hono + Drizzle ORM + Postgres + Clerk (two apps: client + staff) + Stripe + R2 + Nodemailer SMTP.
- Routes split by audience (`routes/portal/{admin,instructor}/`, `routes/client/`, `routes/public/`, `routes/webhooks/`); services split by feature (`services/<feature>/`).
- See `docs/md/backend-architecture.md` for the spine.

## Tech Decisions

- **Framework**: Hono (NOT Express — spec choice).
- **Email**: SMTP via Nodemailer, provider-agnostic via env vars (no Resend).
- **Background jobs**: `node-cron` in v1; BullMQ added when refund durability lands.
- **Multi-tenant**: NO. Yoga Sadhana is hardcoded throughout.

## Deployment

Both frontends ship to Vercel (one Vercel project each, Root Directory pointed at the subfolder); the backend ships to a self-hosted VPS via GitHub Actions.

| App | Target | How it deploys |
|---|---|---|
| `fe-client/` | Vercel project (Root Directory = `fe-client/`) | Auto-deploy on push to `main`. Env vars set in the Vercel dashboard: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`. Clerk routing URLs are hardcoded in `src/app/layout.tsx` (NOT env-driven). |
| `fe-portal/` | Vercel project (Root Directory = `fe-portal/`) | Auto-deploy on push to `main`. Same env shape as fe-client but with the **staff** Clerk app keys. |
| `be/` | VPS3 (Docker) | `.github/workflows/deploy-be.yml` builds the image, pushes to Docker Hub (`blueprintagency/booking-be`), SSHes to VPS3, writes `.env.booking-be` from GitHub repo secrets/vars, and runs `docker compose up -d` followed by `db:migrate && db:seed`. |

**CORS:** the BE allowlists both frontends via two env vars — `PORTAL_ORIGIN` (required) and `CLIENT_ORIGIN` (optional, omit to lock down to fe-portal only). Both must be full URLs with scheme, no trailing slash. In CI these come from `vars.PORTAL_ORIGIN` / `vars.CLIENT_ORIGIN`.

**Clerk apps:** two separate Clerk applications. fe-portal + `CLERK_STAFF_*` is the staff/instructor app; fe-client + `CLERK_CLIENT_*` is the member-facing app. Cross-app tokens are rejected by the BE middleware on purpose — never share keys between them.

**GitHub repo settings driving `deploy-be.yml`** (see the comment block at the top of the workflow for the canonical list):
- `vars`: `PORT`, `VPS3_HOST`, `DOCKERHUB_USERNAME`, `PORTAL_ORIGIN`, `CLIENT_ORIGIN`, `SUPERADMIN_EMAIL`
- `secrets`: `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DOCKERHUB_TOKEN`, `SSH_PRIVATE_KEY`, `CLERK_STAFF_*` (×3), `CLERK_CLIENT_*` (×3), `SMTP_USER`, `SMTP_PASSWORD`, plus deferred `STRIPE_*` and `R2_*`.

## Conventions

- Keep `fe-client/`, `fe-portal/`, and `be/` fully decoupled — no shared dependencies between them.
- Docs go in `docs/md/` (markdown source) or `docs/html/` (rendered/static).
- Do not commit `.env` files or secrets.
- Schema changes go through PR review by both backend devs (single `drizzle.config.ts`, single migration history).
- No business logic in route files — routes do `auth → zod parse → call service → format response`. Domain rules live in `services/*` so admin and client paths can't drift.
- **Env changes must update `.github/workflows/deploy-be.yml`** whenever a BE env var is added, renamed, or removed. The workflow's required-settings comment block AND the `echo "FOO=..."` lines that write `.env.booking-be` must both match `be/src/env.ts` exactly — and `be/.env.example` should reflect the same shape. Forgetting any of these makes prod boot fail Zod validation or silently miss a value. Same rule applies to fe-client/fe-portal env: if you add a `NEXT_PUBLIC_*` var, remember it also has to be set in the Vercel project dashboard.
- **Commit messages**: do NOT include `Co-Authored-By: Claude …` trailers or `🤖 Generated with Claude Code` lines. Commits should be attributed solely to the human author.
