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
| `fe-client/` | Vercel project `booking-system` (Root Directory = `fe-client/`) | `main` → `https://yogasadhana.reservetoday.app`; `staging` → `https://staging.yogasadhana.reservetoday.app`. Env vars: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_APP_ENV` — set **twice**, once per scope (Production / Preview). Clerk routing URLs are hardcoded in `src/app/layout.tsx` (NOT env-driven). |
| `fe-portal/` | Vercel project `booking-system-admin` (Root Directory = `fe-portal/`) | `main` → `https://portal.yogasadhana.reservetoday.app`; `staging` → `https://staging-portal.yogasadhana.reservetoday.app`. Same env shape as fe-client, but with the **staff** Clerk app keys. |
| `be/` | bpvps2 (Docker) | Auto-deploy on push to `staging` **or** `main` (paths-filtered to `be/**`). `.github/workflows/deploy-be.yml` builds the image, pushes to Docker Hub (`blueprintagency/booking-be`), SSHes to bpvps2 over Tailscale, writes `.env.booking-be` from the branch's GitHub Environment, and runs migrate/seed + `docker compose up -d`. |

**Deploy branch & environments:** two live environments, one per branch.

| | `staging` branch | `main` branch |
|---|---|---|
| Backend | `booking-staging` stack on bpvps2 → `https://api.staging.reservetoday.app` | `booking-prod` stack on bpvps2 → `https://api.reservetoday.app` |
| GitHub Environment | `staging` (lowercase) | `Production` (capital P) |
| Image tag | `blueprintagency/booking-be:staging` | `…:latest` |
| fe-client | `https://staging.yogasadhana.reservetoday.app` | `https://yogasadhana.reservetoday.app` |
| fe-portal | `https://staging-portal.yogasadhana.reservetoday.app` | `https://portal.yogasadhana.reservetoday.app` |
| Vercel target | **preview** (branch-pinned domain) | **production** |
| `PORTAL_ORIGIN` / `CLIENT_ORIGIN` | the two staging URLs above | the two production URLs above |
| Clerk instance | development (`*.clerk.accounts.dev`) | production (`clerk.reservetoday.app`, `clerk.yogasadhana.reservetoday.app`) |
| `APP_ENV` / `NEXT_PUBLIC_APP_ENV` | `staging` | `production` |

> **Every staging/production URL is a real domain — do not test against `*.vercel.app`.**
> The generated aliases still exist and still resolve, but the backend's CORS allowlist contains
> only the four domains above, so a `.vercel.app` alias fails every API call. The trap is
> `booking-system-admin-git-main-….vercel.app`: it reads like a dev URL but `-git-main-` is the
> **production** build, so it fails on CORS *and* serves production Clerk. Vercel truncates the
> staging alias to `booking-system-adm-git-40d5d8-…` (63-char DNS label limit), which is why it
> looks nothing like a staging URL.

`NODE_ENV` stays `production` on any server/build, incl. Vercel previews (build flag — enables optimizations + JSON logging); the environment NAME lives in `APP_ENV` (backend) / `NEXT_PUBLIC_APP_ENV` (frontend). Sentry reports from any deployed env (`APP_ENV !== development`) and is off in local dev.

> **`booking-staging` carries the real data.** It predates `booking-prod`, which is a fresh
> database. Migrating that data is a separate job — don't assume prod is populated.

> There is no `vercel.json` in either frontend on purpose. Vercel's defaults already give
> `main` → production and every other branch → preview; a `git.deploymentEnabled` block existed
> only while `main` was intentionally dead, and re-adding one silently disables a branch.

> The BE Traefik router matches a **full** hostname (`BOOKING_FQDN`), not `${BOOKING_HOST}.${BASE_DOMAIN}` —
> bpvps2's host-wide `BASE_DOMAIN` is `teeko.ai` and cannot express `reservetoday.app`. The compose
> lives in the infra repo at `vps/bpvps2/stacks/booking/docker-compose.yml`.

**CORS:** the BE allowlists both frontends via `PORTAL_ORIGIN` (required) and `CLIENT_ORIGIN` (optional, omit to lock down to fe-portal only). Each can be an exact full URL with scheme and no trailing slash, or a leading-wildcard origin such as `https://*.vercel.app` for Vercel preview URLs. Exact URLs are also used as canonical link bases for staff invites / client redirects; wildcard values should only be used when that tradeoff is acceptable. In CI these come from `vars.PORTAL_ORIGIN` / `vars.CLIENT_ORIGIN`.

**Clerk apps:** two separate Clerk applications. fe-portal + `CLERK_STAFF_*` is the staff/instructor app; fe-client + `CLERK_CLIENT_*` is the member-facing app. Cross-app tokens are rejected by the BE middleware on purpose — never share keys between them.

**GitHub repo settings driving `deploy-be.yml`** (see the comment block at the top of the workflow for the canonical list). The workflow job runs in the GitHub Environment named by the branch (`staging` / `Production`), so repo/environment settings can override organization-level settings with the same name. Shared deploy settings should live under the **Blueprint-Agency organization** and grant access to `booking-system`.
- `org vars`: `BPVPS2_TAILSCALE_HOST`, `DOCKERHUB_USERNAME`
- `env vars` (set in **both** Environments): `PORT`, `PORTAL_ORIGIN`, `CLIENT_ORIGIN`, `SUPERADMIN_EMAIL`
- `org secrets`: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`
- `repo/env secrets`: `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DOCKERHUB_TOKEN`, `SSH_PRIVATE_KEY`, `CLERK_STAFF_*` (×3), `CLERK_CLIENT_*` (×3), `SMTP_USER`, `SMTP_PASSWORD`, `SENTRY_DSN` (optional — error monitoring), plus deferred `STRIPE_*` and `R2_*`.
- `NODE_ENV` (always `production`), `APP_ENV`, `ENV_NAME`, `STACK_DIR`, `BOOKING_FQDN` and `IMAGE_TAG` are derived from the branch in the workflow's `env:` block, not from repo settings.

## Conventions

- Keep `fe-client/`, `fe-portal/`, and `be/` fully decoupled — no shared dependencies between them.
- Docs go in `docs/md/` (markdown source) or `docs/html/` (rendered/static). Two exceptions, both deliberate: the **domain glossary** for a context lives at `<context>/CONTEXT.md` (indexed by the root `CONTEXT-MAP.md`), and **ADRs** live beside the code they govern at `<context>/docs/adr/NNNN-slug.md` — `be/docs/adr/` today. A decision spanning all three apps goes in a root `docs/adr/` instead. Specs stay in `docs/md/`; a glossary is not a spec and an ADR is not a spec.
- Do not commit `.env` files or secrets.
- Schema changes go through PR review by both backend devs (single `drizzle.config.ts`, single migration history).
- No business logic in route files — routes do `auth → zod parse → call service → format response`. Domain rules live in `services/*` so admin and client paths can't drift.
- **Env changes must update `.github/workflows/deploy-be.yml`** whenever a BE env var is added, renamed, or removed. The workflow's required-settings comment block AND the `echo "FOO=..."` lines that write `.env.booking-be` must both match `be/src/env.ts` exactly — and `be/.env.example` should reflect the same shape. Forgetting any of these makes prod boot fail Zod validation or silently miss a value. Same rule applies to fe-client/fe-portal env: if you add a `NEXT_PUBLIC_*` var, remember it also has to be set in the Vercel project dashboard.
- **Commit messages**: do NOT include `Co-Authored-By: Claude …` trailers or `🤖 Generated with Claude Code` lines. Commits should be attributed solely to the human author.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `Blueprint-Agency/booking-system`, driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, used verbatim: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context — root `CONTEXT-MAP.md` pointing at a `CONTEXT.md` per app (`fe-client/`, `fe-portal/`, `be/`). See `docs/agents/domain.md`.
