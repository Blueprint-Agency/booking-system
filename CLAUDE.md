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

- **fe-client mockup**: ✅ done (clickable prototype, no live backend yet)
- **fe-portal mockup**: ✅ done (clickable prototype, no live backend yet)
- **be**: 🚧 in progress — structural scaffolding exists; schema/routes reshape pending per `docs/md/backend-architecture.md`. Service-layer business logic mostly empty stubs.

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

- **Vercel project**: `booking-system` (root-linked via `.vercel/project.json`).
- No `vercel.json` at root currently — Vercel project Root Directory + Build Command live in the dashboard.
- After the `fe-admin` → `fe-portal` rename, the Vercel dashboard's Root Directory setting may need updating manually if it pointed at `fe-admin/`.

## Conventions

- Keep `fe-client/`, `fe-portal/`, and `be/` fully decoupled — no shared dependencies between them.
- Docs go in `docs/md/` (markdown source) or `docs/html/` (rendered/static).
- Do not commit `.env` files or secrets.
- Schema changes go through PR review by both backend devs (single `drizzle.config.ts`, single migration history).
- No business logic in route files — routes do `auth → zod parse → call service → format response`. Domain rules live in `services/*` so admin and client paths can't drift.
