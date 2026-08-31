# Deployment

Both frontends ship to Vercel (one Vercel project each, Root Directory pointed at the subfolder); the backend ships to a self-hosted VPS via GitHub Actions.

| App | Target | How it deploys |
|---|---|---|
| `fe-client/` | Vercel project `booking-system` (Root Directory = `fe-client/`) | `main` → `https://{slug}.reservetoday.app` (wildcard `*.reservetoday.app`); `staging` → `https://{slug}.dev.reservetoday.app` (wildcard `*.dev.reservetoday.app`). Env vars: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ROOT_DOMAIN`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_APP_ENV` — set **twice**, once per scope (Production / Preview). Clerk routing URLs are hardcoded in `src/app/layout.tsx` (NOT env-driven). |
| `fe-portal/` | Vercel project `booking-system-admin` (Root Directory = `fe-portal/`) | `main` → `https://{slug}.portal.reservetoday.app` (wildcard `*.portal.reservetoday.app`); `staging` → `https://{slug}.portal.dev.reservetoday.app`. Same env shape as fe-client, but with the **staff** Clerk app keys and its own `NEXT_PUBLIC_ROOT_DOMAIN` (the `portal.` one). |
| `cdn/` | Vercel project `booking-cdn` (Root Directory = `cdn/`) | Edge proxy fronting the R2 bucket at `https://cdn.reservetoday.app`. One env var, `R2_ORIGIN`, the bucket's `pub-<hash>.r2.dev` URL. No DNS record needed — the zone's `*` ALIAS already resolves the name. **Not Git-connected**: deployed with `vercel deploy --prod` from `cdn/`, not on push. |
| `be/` | bpvps2 (Docker) | Auto-deploy on push to `staging` **or** `main` (paths-filtered to `be/**`). `.github/workflows/deploy-be.yml` builds the image, pushes to Docker Hub (`blueprintagency/booking-be`), SSHes to bpvps2 over Tailscale, writes `.env.booking-be` from the branch's GitHub Environment, and runs migrate/seed + `docker compose up -d`. |

**Deploy branch & environments:** two live environments, one per branch.

| | `staging` branch | `main` branch |
|---|---|---|
| Backend | `booking-staging` stack on bpvps2 → `https://api.staging.reservetoday.app` | `booking-prod` stack on bpvps2 → `https://api.reservetoday.app` |
| GitHub Environment | `staging` (lowercase) | `Production` (capital P) |
| Image tag | `blueprintagency/booking-be:staging` | `…:latest` |
| fe-client | `https://{slug}.dev.reservetoday.app` (e.g. `yogasadhana.dev.…`) | `https://{slug}.reservetoday.app` (e.g. `yogasadhana.reservetoday.app`) |
| fe-portal | `https://{slug}.portal.dev.reservetoday.app` | `https://{slug}.portal.reservetoday.app` |
| Super portal | `https://admin.portal.dev.reservetoday.app` | `https://admin.portal.reservetoday.app` |
| Vercel target | **preview** (branch-pinned domain) | **production** |
| `PORTAL_ORIGIN` / `CLIENT_ORIGIN` | exact URLs — the legacy single-studio hostnames below | exact URLs — the legacy single-studio hostnames below |
| `TENANT_ORIGIN_PATTERNS` | `https://*.dev.reservetoday.app,https://*.portal.dev.reservetoday.app` | `https://*.reservetoday.app,https://*.portal.reservetoday.app` |
| Clerk instance | development (`*.clerk.accounts.dev`) | production — fe-client on `clerk.booking-system-eight-fawn.vercel.app`, fe-portal on `clerk.project-3p3dw.vercel.app` |
| `APP_ENV` / `NEXT_PUBLIC_APP_ENV` | `staging` | `production` |

> **The legacy single-studio hostnames still exist and have not been retired.**
> `yogasadhana.reservetoday.app` is unchanged and is already the Tenant-subdomain form. The four
> older names — `staging.yogasadhana.reservetoday.app`, `portal.yogasadhana.reservetoday.app`,
> `staging-portal.yogasadhana.reservetoday.app`, `staging.reservetoday.app` — are branch-assigned
> domains from the pre-tenancy scheme and still hold certificates. The **portal URL flip**
> (`portal.yogasadhana.…` → `yogasadhana.portal.…`) is Phase 5 of
> `docs/md/multi-tenancy-plan.md` and is not done: it needs a 301 on the old host, a
> `PORTAL_ORIGIN` change, Clerk allowed-origin/redirect updates, and staff comms. Until then both
> forms must stay in the allowlist.

> **Backend staging is still `api.staging.reservetoday.app`, not `api.dev.…`.** The frontends
> settled on `dev` as the staging label and the backend has not moved. The rename (keeping the old
> name as an alias) is a Phase 5 item; `BOOKING_FQDN` in `deploy-be.yml` is the one place to
> change it.

> **Every staging/production URL is a real domain — do not test against `*.vercel.app`.**
> The generated aliases still exist and still resolve, but the backend's CORS allowlist contains
> only the exact origins and the Tenant wildcard patterns above, so a `.vercel.app` alias fails
> every API call. The trap is
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

**CORS:** the BE allowlist is assembled from three env vars, and the same list also backs the public-route `Origin` check and the Clerk `azp` check — see `docs/md/spec-tenant-resolution.md`. If they disagreed, one would become the hole in the other two.

- `PORTAL_ORIGIN` (required) and `CLIENT_ORIGIN` (optional, omit to lock down to fe-portal only). Each can be an exact full URL with scheme and no trailing slash, or a leading-wildcard origin such as `https://*.vercel.app` for Vercel preview URLs. Exact URLs are also used as canonical link bases for staff invites / client redirects; wildcard values should only be used when that tradeoff is acceptable. In CI these come from `vars.PORTAL_ORIGIN` / `vars.CLIENT_ORIGIN`.
- `TENANT_ORIGIN_PATTERNS` (optional, `vars.TENANT_ORIGIN_PATTERNS`) — comma-separated tenant subdomain origins. **A tenant is created by inserting a row**, so its origin cannot be listed in advance; this is the pattern that admits a studio which did not exist when the backend was deployed. The `*` must be the **leftmost** label and covers **exactly one** label — the same boundary the certificates enforce (RFC 6125), so `a.b.reservetoday.app` is unserveable in production and is not allowlisted either.
  - staging: `https://*.dev.reservetoday.app,https://*.portal.dev.reservetoday.app`
  - production: `https://*.reservetoday.app,https://*.portal.reservetoday.app`

**Clerk authorized parties:** `CLERK_STAFF_AUTHORIZED_PARTIES` is **no longer passed to Clerk**. Clerk's own `authorizedParties` option is exact-match and cannot express `{slug}.portal.…` for every slug that exists — a list that would change whenever a studio is created, signing staff out of one made overnight. `verifyToken` is called without it and the `azp` claim is checked against the allowlist above instead (`be/src/lib/allowed-origins.ts`). The var still contributes any extra exact origins an environment wants to pin.

> ⚠️ **The allowlist is now shared, so a wildcard in it widens `azp` too.** Setting `CLIENT_ORIGIN` or `PORTAL_ORIGIN` to something like `https://*.vercel.app` for preview URLs used to affect CORS only; it now also makes every Vercel preview host a valid authorized party for staff and member tokens. Both deployed environments use exact URLs today — keep it that way, and put preview hosts in `TENANT_ORIGIN_PATTERNS` only if that tradeoff is understood.

**Clerk apps:** two separate Clerk applications. fe-portal + `CLERK_STAFF_*` is the staff/instructor app; fe-client + `CLERK_CLIENT_*` is the member-facing app. Cross-app tokens are rejected by the BE middleware on purpose — never share keys between them.

> **Clerk production runs on Vercel-generated hosts, not on `reservetoday.app`.** The zone did
> carry two full Clerk custom-domain sets (`accounts`, `clerk`, `clkmail`, `clk._domainkey`,
> `clk2._domainkey`, for both `reservetoday.app` and `yogasadhana.reservetoday.app`), but they were
> lost in the 2026-08-31 nameserver move and both live publishable keys decode to `*.vercel.app`
> frontend API hosts, so sign-in is unaffected. Whether the Clerk dashboard still expects those
> custom domains is unverified — see `docs/adr/0001-reservetoday-app-on-vercel-nameservers.md`.

> **`R2_PUBLIC_URL` is a CDN hostname, never a `pub-….r2.dev` URL.** `cdn.reservetoday.app` can no
> longer be an R2 custom domain — R2 binds one through the Cloudflare proxy, which needs the zone
> on Cloudflare nameservers, and this zone moved to Vercel. The `cdn/` project fronts the bucket
> from Vercel's edge instead and keeps `r2.dev` as a private origin; see `cdn/README.md` and
> `docs/adr/0001-reservetoday-app-on-vercel-nameservers.md`.
>
> Every asset-URL builder — `be/src/lib/r2.ts`, `services/schedule/client-catalog.ts`,
> `services/workshops/catalog.ts` — returns `null` when `R2_PUBLIC_URL` is unset, so a missing
> value costs you every image with no error anywhere. The `Production` GitHub Environment held no
> `R2_*` secrets at all until this was wired up, which is exactly how it went unnoticed.

**GitHub repo settings driving `deploy-be.yml`** (see the comment block at the top of the workflow for the canonical list). The workflow job runs in the GitHub Environment named by the branch (`staging` / `Production`), so repo/environment settings can override organization-level settings with the same name. Shared deploy settings should live under the **Blueprint-Agency organization** and grant access to `booking-system`.
- `org vars`: `BPVPS2_TAILSCALE_HOST`, `DOCKERHUB_USERNAME`
- `env vars` (set in **both** Environments): `PORT`, `PORTAL_ORIGIN`, `CLIENT_ORIGIN`, `TENANT_ORIGIN_PATTERNS`, `SUPERADMIN_EMAIL`, `PLATFORM_ADMIN_EMAILS` (optional), `MAIL_FROM_EMAIL` / `MAIL_FROM_NAME` (optional — the platform's envelope identity; see below)
- `org secrets`: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`
- `repo/env secrets`: `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_APP_PASSWORD`, `DOCKERHUB_TOKEN`, `SSH_PRIVATE_KEY`, `CLERK_STAFF_*` (×3), `CLERK_CLIENT_*` (×3), `SMTP_USER`, `SMTP_PASSWORD`, `SENTRY_DSN` (optional — error monitoring), `R2_*` (×5 — required in **both** Environments; see the `R2_PUBLIC_URL` note above), plus deferred `STRIPE_*`.
- `NODE_ENV` (always `production`), `APP_ENV`, `ENV_NAME`, `STACK_DIR`, `BOOKING_FQDN` and `IMAGE_TAG` are derived from the branch in the workflow's `env:` block, not from repo settings.
- `ENABLE_JOBS` is hardcoded `true` in the workflow — the background cron jobs (`be/src/jobs/index.ts`) are not optional on a deployed server. With it off, pending PT requests never expire and members' session credits are never auto-refunded.

**Two database connections, and why.** `DATABASE_URL` is the owner role (`DB_USER`) and is used for migrations and seeds only. The running server connects with `DATABASE_APP_URL`, built from `DB_APP_PASSWORD` for the `booking_app` role that `npm run db:migrate` provisions (`be/src/db/roles.ts`). This is not cosmetic: Postgres exempts superusers and table owners from Row-Level Security, so pointing the server at `DATABASE_URL` would leave the tenant policies (migration 0033) enforcing nothing while every request still succeeded. **`DB_APP_PASSWORD` must be set as an environment secret in BOTH `staging` and `Production` before the first deploy carrying this change** — without it the backend fails Zod validation at boot, which is the intended failure for a missing security control. The reasoning is recorded in `docs/adr/0002-shared-schema-row-level-security.md`.

**Outbound mail leaves on one envelope, and it must be one the credentials own.** Every tenant's transactional mail is sent through the single Gmail account behind `SMTP_USER`, wearing that tenant's display name and its own `Reply-To` — a tenant's *own* domain on the `From` line would fail that domain's SPF and DKIM, because our credentials are not authorised there. `MAIL_FROM_EMAIL` is that envelope address and defaults to `SMTP_USER` when blank; `MAIL_FROM_NAME` is shown only for a tenant with no name of its own, and defaults to `ReserveToday`. Both are optional, so a fresh Environment that sets neither boots and sends correctly. **Setting `MAIL_FROM_EMAIL` to an address the Gmail account is not a verified alias for deploys green and then fails every send at Gmail with a 5.5.1** — it is validated at boot only as a well-formed address, never as one we may send as. The decision and its upgrade path are in `docs/md/mail-identity.md`.

**Env changes must update `.github/workflows/deploy-be.yml`** whenever a BE env var is added, renamed, or removed. The workflow's required-settings comment block AND the `echo "FOO=..."` lines that write `.env.booking-be` must both match `be/src/env.ts` exactly — and `be/.env.example` should reflect the same shape. Forgetting any of these makes prod boot fail Zod validation or silently miss a value. Same rule applies to fe-client/fe-portal env: if you add a `NEXT_PUBLIC_*` var, remember it also has to be set in the Vercel project dashboard.
