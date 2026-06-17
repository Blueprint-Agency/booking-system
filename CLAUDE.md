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
- **fe-client**: 🟢 fully wired to live BE — classes (browse/book/cancel), packages (incl. trial claim + Stripe checkout), workshops (browse/buy + account list), PT requests, corporate, account/*. The old mock-state layer has been deleted.
- **be**: 🟡 schema + portal admin routes + client paths (catalog, class bookings, Stripe checkout for packages/workshops, sync-session, PT requests, corporate) implemented; still 501-stubbed: refunds, invoices, waiver, referral, dashboard, booking QR PNG, marketing.

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
| `fe-client/` | Vercel project (Root Directory = `fe-client/`) | Push to `staging` → Vercel **preview** deployment; pushes to `main` deploy nothing (disabled via `vercel.json` → `git.deploymentEnabled`). Env vars (set for the **Preview** scope): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_APP_ENV` (=`staging`). Clerk routing URLs are hardcoded in `src/app/layout.tsx` (NOT env-driven). |
| `fe-portal/` | Vercel project (Root Directory = `fe-portal/`) | Push to `staging` → Vercel **preview** deployment; `main` disabled via `vercel.json`. Same env shape as fe-client (incl. `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_APP_ENV`), set for the **Preview** scope, but with the **staff** Clerk app keys. |
| `be/` | VPS3 (Docker) | Auto-deploy on push to the `staging` branch (paths-filtered to `be/**`). `.github/workflows/deploy-be.yml` builds the image, pushes to Docker Hub (`blueprintagency/booking-be`), SSHes to VPS3, writes `.env.booking-be` from GitHub repo secrets/vars, and runs `docker compose up -d` followed by `db:migrate && db:seed`. |

**Deploy branch & environments:** all non-local deploys currently target the **`staging`** branch — pushing to `staging` triggers the BE workflow (VPS) and a Vercel **preview** deployment of both frontends. Pushing to `main` deploys nothing: the BE workflow ignores it, and each frontend's `vercel.json` disables `main` (`git.deploymentEnabled`). **There is no production server yet — staging runs as a Vercel preview** (so set Vercel env vars on the **Preview** scope; do NOT set the Production Branch to `staging`). `NODE_ENV` stays `production` on any server/build, incl. Vercel previews (build flag — enables optimizations + JSON logging); the environment NAME lives in `APP_ENV` (backend) / `NEXT_PUBLIC_APP_ENV` (frontend), set to `staging`. When a prod server is added, give it a `main`→production deploy path (re-enable `main` in `vercel.json` + set its Production Branch) and set those to `production`. Sentry reports from any deployed env (`APP_ENV !== development`) and is off in local dev.

**CORS:** the BE allowlists both frontends via `PORTAL_ORIGIN` (required) and `CLIENT_ORIGIN` (optional, omit to lock down to fe-portal only). Each can be an exact full URL with scheme and no trailing slash, or a leading-wildcard origin such as `https://*.vercel.app` for Vercel preview URLs. Exact URLs are also used as canonical link bases for staff invites / client redirects; wildcard values should only be used when that tradeoff is acceptable. In CI these come from `vars.PORTAL_ORIGIN` / `vars.CLIENT_ORIGIN`.

**Clerk apps:** two separate Clerk applications. fe-portal + `CLERK_STAFF_*` is the staff/instructor app; fe-client + `CLERK_CLIENT_*` is the member-facing app. Cross-app tokens are rejected by the BE middleware on purpose — never share keys between them.

**GitHub repo settings driving `deploy-be.yml`** (see the comment block at the top of the workflow for the canonical list). The workflow job runs in the GitHub **`staging`** Environment, so repo/environment settings can override organization-level settings with the same name. Shared deploy settings should live under the **Blueprint-Agency organization** and grant access to `booking-system`.
- `org vars`: `VPS3_TAILSCALE_HOST`
- `repo/env vars`: `PORT`, `VPS3_HOST`, `DOCKERHUB_USERNAME`, `PORTAL_ORIGIN`, `CLIENT_ORIGIN`, `SUPERADMIN_EMAIL`
- `org secrets`: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`
- `repo/env secrets`: `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DOCKERHUB_TOKEN`, `SSH_PRIVATE_KEY`, `CLERK_STAFF_*` (×3), `CLERK_CLIENT_*` (×3), `SMTP_USER`, `SMTP_PASSWORD`, `SENTRY_DSN` (optional — error monitoring), plus deferred `STRIPE_*` and `R2_*`.
- `NODE_ENV` (=`production`) and `APP_ENV` (=`staging`) are hardcoded in the workflow, not repo settings.

## Conventions

- Keep `fe-client/`, `fe-portal/`, and `be/` fully decoupled — no shared dependencies between them.
- Docs go in `docs/md/` (markdown source) or `docs/html/` (rendered/static).
- Do not commit `.env` files or secrets.
- Schema changes go through PR review by both backend devs (single `drizzle.config.ts`, single migration history).
- No business logic in route files — routes do `auth → zod parse → call service → format response`. Domain rules live in `services/*` so admin and client paths can't drift.
- **Env changes must update `.github/workflows/deploy-be.yml`** whenever a BE env var is added, renamed, or removed. The workflow's required-settings comment block AND the `echo "FOO=..."` lines that write `.env.booking-be` must both match `be/src/env.ts` exactly — and `be/.env.example` should reflect the same shape. Forgetting any of these makes prod boot fail Zod validation or silently miss a value. Same rule applies to fe-client/fe-portal env: if you add a `NEXT_PUBLIC_*` var, remember it also has to be set in the Vercel project dashboard.
- **Commit messages**: do NOT include `Co-Authored-By: Claude …` trailers or `🤖 Generated with Claude Code` lines. Commits should be attributed solely to the human author.
