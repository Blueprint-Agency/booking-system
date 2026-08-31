# Deployment

Both frontends ship to Vercel (one Vercel project each, Root Directory pointed at the subfolder); the backend ships to a self-hosted VPS via GitHub Actions.

| App | Target | How it deploys |
|---|---|---|
| `fe-client/` | Vercel project `booking-system` (Root Directory = `fe-client/`) | `main` → `https://yogasadhana.reservetoday.app`; `staging` → `https://staging.yogasadhana.reservetoday.app`. Env vars: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ROOT_DOMAIN`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_APP_ENV` — set **twice**, once per scope (Production / Preview). Clerk routing URLs are hardcoded in `src/app/layout.tsx` (NOT env-driven). |
| `fe-portal/` | Vercel project `booking-system-admin` (Root Directory = `fe-portal/`) | `main` → `https://portal.yogasadhana.reservetoday.app`; `staging` → `https://staging-portal.yogasadhana.reservetoday.app`. Same env shape as fe-client, but with the **staff** Clerk app keys and its own `NEXT_PUBLIC_ROOT_DOMAIN` (the `portal.` one). |
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
| Clerk instance | development (`*.clerk.accounts.dev`) | production — fe-client on `clerk.booking-system-eight-fawn.vercel.app`, fe-portal on `clerk.project-3p3dw.vercel.app` |
| `APP_ENV` / `NEXT_PUBLIC_APP_ENV` | `staging` | `production` |

> **Every staging/production URL is a real domain — do not test against `*.vercel.app`.**
> The generated aliases still exist and still resolve, but the backend's CORS allowlist contains
> only the four domains above, so a `.vercel.app` alias fails every API call. The trap is
> `booking-system-admin-git-main-….vercel.app`: it reads like a dev URL but `-git-main-` is the
> **production** build, so it fails on CORS *and* serves production Clerk. Vercel truncates the
> staging alias to `booking-system-adm-git-40d5d8-…` (63-char DNS label limit), which is why it
> looks nothing like a staging URL.

## `NEXT_PUBLIC_ROOT_DOMAIN` — tenant resolution

Both frontends work out which Tenant a request is for from the hostname alone. There is one rule
and it is the same everywhere: **`NEXT_PUBLIC_ROOT_DOMAIN` is everything after the Tenant slug, and
the slug is the hostname minus that suffix.** Environments differ only in the value of the
variable, so a Host-parsing bug cannot appear in production alone. The extraction is a pure
function (`src/lib/tenant-host.ts`, unit-tested in both apps) and `proxy.ts` is a thin wrapper over
it.

| | fe-client | fe-portal |
|---|---|---|
| Local (`.env.local`) | `localhost:3000` | `portal.localhost:3001` |
| Staging (Vercel → Preview) | `dev.reservetoday.app` | `portal.dev.reservetoday.app` |
| Production (Vercel → Production) | `reservetoday.app` | `portal.reservetoday.app` |

It is a `NEXT_PUBLIC_*` var, so per the repo convention it **must also be set in the Vercel project
dashboard** — once per scope, Production and Preview — or the deployed build falls back to the
local default and resolves nothing. It is inlined at build time: changing it needs a redeploy, not
a restart.

Notes:

- The port is stripped from both sides of the comparison, so a dev server on another port still
  resolves Tenants.
- Locally, `*.localhost` reaches loopback in Chrome, Edge and Firefox with **no hosts-file entry**,
  multi-level names included — `acme.localhost:3000` and `acme.portal.localhost:3001` just work.
  Safari does not do this; Safari users add `127.0.0.1 acme.localhost` or use `lvh.me`.
- The proxy resolves the slug against the backend's public route
  (`GET /api/v1/public/tenants/by-slug/:slug`) — never the database, since the frontends reach `be`
  over HTTP only. An unknown slug is a bare 404 that names nothing; a backend outage is a 503 (with
  a stale cached Tenant preferred over either).
- The proxy also **deletes every inbound `x-tenant-*` header** before setting its own, on every
  path, so Tenant context cannot be forged by a caller.

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

> **Clerk production runs on Vercel-generated hosts, not on `reservetoday.app`.** The zone did
> carry two full Clerk custom-domain sets (`accounts`, `clerk`, `clkmail`, `clk._domainkey`,
> `clk2._domainkey`, for both `reservetoday.app` and `yogasadhana.reservetoday.app`), but they were
> lost in the 2026-08-31 nameserver move and both live publishable keys decode to `*.vercel.app`
> frontend API hosts, so sign-in is unaffected. Whether the Clerk dashboard still expects those
> custom domains is unverified — see `docs/adr/0001-reservetoday-app-on-vercel-nameservers.md`.

> **R2 is not configured in production.** The `Production` GitHub Environment holds no `R2_*`
> secrets at all; only `staging` does. Every asset-URL builder — `be/src/lib/r2.ts`,
> `services/schedule/client-catalog.ts`, `services/workshops/catalog.ts` — returns `null` when
> `R2_PUBLIC_URL` is unset, so production serves no imagery and fails silently rather than
> erroring. Staging currently points at the raw bucket URL
> `https://pub-…r2.dev`, which Cloudflare rate-limits and does not intend for production use.

**GitHub repo settings driving `deploy-be.yml`** (see the comment block at the top of the workflow for the canonical list). The workflow job runs in the GitHub Environment named by the branch (`staging` / `Production`), so repo/environment settings can override organization-level settings with the same name. Shared deploy settings should live under the **Blueprint-Agency organization** and grant access to `booking-system`.
- `org vars`: `BPVPS2_TAILSCALE_HOST`, `DOCKERHUB_USERNAME`
- `env vars` (set in **both** Environments): `PORT`, `PORTAL_ORIGIN`, `CLIENT_ORIGIN`, `SUPERADMIN_EMAIL`
- `org secrets`: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`
- `repo/env secrets`: `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DOCKERHUB_TOKEN`, `SSH_PRIVATE_KEY`, `CLERK_STAFF_*` (×3), `CLERK_CLIENT_*` (×3), `SMTP_USER`, `SMTP_PASSWORD`, `SENTRY_DSN` (optional — error monitoring), plus deferred `STRIPE_*` and `R2_*`.
- `NODE_ENV` (always `production`), `APP_ENV`, `ENV_NAME`, `STACK_DIR`, `BOOKING_FQDN` and `IMAGE_TAG` are derived from the branch in the workflow's `env:` block, not from repo settings.
- `ENABLE_JOBS` is hardcoded `true` in the workflow — the background cron jobs (`be/src/jobs/index.ts`) are not optional on a deployed server. With it off, pending PT requests never expire and members' session credits are never auto-refunded.

**Env changes must update `.github/workflows/deploy-be.yml`** whenever a BE env var is added, renamed, or removed. The workflow's required-settings comment block AND the `echo "FOO=..."` lines that write `.env.booking-be` must both match `be/src/env.ts` exactly — and `be/.env.example` should reflect the same shape. Forgetting any of these makes prod boot fail Zod validation or silently miss a value. Same rule applies to fe-client/fe-portal env: if you add a `NEXT_PUBLIC_*` var, remember it also has to be set in the Vercel project dashboard.
