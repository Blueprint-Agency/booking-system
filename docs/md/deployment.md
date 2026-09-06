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
| Backend | `booking-staging` stack on bpvps2 → `https://api.dev.reservetoday.app` | `booking-prod` stack on bpvps2 → `https://api.reservetoday.app` |
| GitHub Environment | `staging` (lowercase) | `Production` (capital P) |
| Image tag | `blueprintagency/booking-be:staging` | `…:latest` |
| fe-client | `https://{slug}.dev.reservetoday.app` (e.g. `yogasadhana.dev.…`) | `https://{slug}.reservetoday.app` (e.g. `yogasadhana.reservetoday.app`) |
| fe-portal | `https://{slug}.portal.dev.reservetoday.app` | `https://{slug}.portal.reservetoday.app` |
| Super portal | `https://admin.portal.dev.reservetoday.app` | `https://admin.portal.reservetoday.app` |
| Vercel target | **preview** (branch-pinned domain) | **production** |
| `TENANT_ORIGIN_PATTERNS` | `https://*.dev.reservetoday.app,https://*.portal.dev.reservetoday.app` | `https://*.reservetoday.app,https://*.portal.reservetoday.app` |
| Clerk instance | development (`*.clerk.accounts.dev`) | production — fe-client on `clerk.reservetoday.app`, fe-portal on `clerk.portal.reservetoday.app`, super portal on `clerk.admin.portal.reservetoday.app` |
| `APP_ENV` / `NEXT_PUBLIC_APP_ENV` | `staging` | `production` |

> **The portal URL flip is done.** `portal.yogasadhana.reservetoday.app` is attached to the
> fe-portal Vercel project as a **301 redirect** to `yogasadhana.portal.reservetoday.app`, path
> and query preserved. It had been returning Vercel's `DEPLOYMENT_NOT_FOUND` 404 — it resolves
> through the apex wildcard but matched no project domain, so a staff bookmark was already broken
> rather than merely old. The redirect target had to be attached explicitly (Vercel refuses to
> redirect to a host the project does not own, and wildcard coverage does not count), which is why
> `yogasadhana.portal.reservetoday.app` now appears as its own row next to the wildcard. That row
> is a redirect target, **not** a per-Tenant domain: provisioning a studio still adds nothing here.
>
> Nothing was needed on the backend or in Clerk. `yogasadhana.portal.…` is covered by
> `*.portal.reservetoday.app`, is what the backend already builds staff links from, and is what the
> portal Clerk instance already authenticates — a redirect is a browser-side hop that never reaches
> the API, so no exact origin has to be added to `TENANT_ORIGIN_PATTERNS`.
>
> **Three legacy staging hostnames remain**, and unlike the portal one they still work:
> `staging.yogasadhana.reservetoday.app`, `staging-portal.yogasadhana.reservetoday.app`,
> `staging.reservetoday.app` — branch-assigned domains from the pre-tenancy scheme, still holding
> certificates. They are superseded by `{slug}.dev.reservetoday.app` and
> `{slug}.portal.dev.reservetoday.app`, and can be given the same 301 treatment whenever someone
> is sure nobody's bookmarks depend on them. `staging.reservetoday.app` names no studio at all, so
> retiring it needs a decision about which Tenant it should land on rather than a redirect.

> **Production Clerk now sits on `reservetoday.app`.** This block used to record the opposite —
> that both instances answered on Vercel-generated hosts
> (`clerk.booking-system-eight-fawn.vercel.app`, `clerk.project-3p3dw.vercel.app`), which is what
> issue #74 existed to fix. That migration has landed. Verified from the live
> `pk_live_` keys, which encode their own Frontend API host: the client instance is
> `clerk.reservetoday.app` and the portal instance `clerk.portal.reservetoday.app`, both
> resolving. `scripts/clerk-prod-domain-migration.sh` is kept for the record but has been run and
> should not be run again.
>
> Being rooted at the shared parent domain is what makes tenant subdomains authenticate without
> being enumerated — the property the Vercel-host arrangement could not have. **Leave
> `Configure → Domains → Allowed Subdomains` disabled**: a Tenant is created by inserting a row,
> so it cannot be allowlisted in advance, and enabling that setting would turn every new studio
> into a dashboard chore.

> **The backend staging host is `api.dev.reservetoday.app`.** It used to be
> `api.staging.reservetoday.app`, which disagreed with the `dev` label both frontends settled on.
> `BOOKING_FQDN` in `deploy-be.yml` names `api.dev`, the `api.dev` A record exists in Vercel DNS
> (`rec_990affe97080aea4f5e03e33` → `187.127.207.82`), and `NEXT_PUBLIC_API_URL` on the **Preview**
> scope of both Vercel projects already reads `https://api.dev.reservetoday.app`. Nothing points at
> the old name any more, so the next staging deploy is the moment it stops being served.
>
> **`BOOKING_FQDN_ALIAS` is gone.** The Traefik rule is now a single
> ``Host(`${BOOKING_FQDN}`)``. The alias was the second hostname in that rule, so a rename could
> overlap — the new name serving a valid certificate before anything was repointed at it, the old
> name still answering until nothing called it — and the `api.staging` → `api.dev` rename it
> existed for is finished. Both stacks had been carrying it set equal to `BOOKING_FQDN`, so the
> rule read ``Host(x) || Host(x)``.
>
> It was removed rather than left idle because idle was not free: the variable was **required**
> whether or not a rename was in flight, since an unset one renders ``Host(``)``, which Traefik
> rejects — the router then vanishes while TLS still terminates, so the failure presents as a 404
> rather than an outage. A mechanism that breaks the API when someone tidies away a duplicate line
> is worse than writing the second `Host()` again on the day it is next needed. When that day
> comes: ``Host(a) || Host(b)``, never ``Host(a, b)`` — Traefik v3's matcher takes exactly one
> parameter and rejects the list form.
>
> The `api.staging` A record is gone from Vercel DNS too — the zone holds `api` and `api.dev` and
> nothing else beginning `api`. The name still *resolves*, because the apex `*` ALIAS answers for
> anything unclaimed, but it resolves to Vercel and 404s rather than reaching the backend. Nothing
> to do; noted so the next person does not go looking for a record to delete.

> **The two backend deploys cannot run at the same time, and the workflow now enforces it.**
> Both stacks live on bpvps2 and share one Docker daemon, therefore one containerd content store.
> Two `docker compose up` runs pulling at once collide there with
> `unable to lease content: lease does not exist: not found`. The failure is nastier than it looks:
> the explicit `docker pull` succeeds and compose's own re-pull is what dies, so the job fails
> **after migrations have already run** — leaving the stack on its old image against a migrated
> database. It stays healthy and serves the previous build, which is why nobody notices from the
> outside.
>
> This bit twice on 2026-09-06, both times with the `main` run starting ~40 seconds behind the
> `staging` one, because merging to `staging` and then fast-forwarding `main` fires both within a
> minute. The `concurrency.group` in `deploy-be.yml` is therefore **not** keyed on the branch —
> `booking-be-deploy-bpvps2`, with `cancel-in-progress: false`, so the second deploy waits rather
> than racing or being dropped. Queueing is the fix, not the cost.
>
> If you ever see that error anyway: re-run the failed job once the other one has finished, and
> **check the running image against the tag** before assuming it recovered —
> `docker inspect booking-be-prod --format '{{.Image}}'` against
> `docker image inspect blueprintagency/booking-be:latest --format '{{.Id}}'`. A healthy container
> is not evidence of a current one.

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

> **Check which Clerk instance a deployed page actually loads — the Preview scope has been wrong
> before.** Both projects' Preview-scope `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`
> held `pk_live` / `sk_live` values, so staging signed people in against **production Clerk**,
> sharing its user directory and sessions. It survived undetected because staging had no tenant
> subdomain to render until the wildcards landed, and because Vercel marks those keys sensitive —
> they cannot be read back through the API or the dashboard, so the wiring could not be checked by
> inspection. The rendered page can be, and that is the reliable test:
> `curl -sL https://{slug}.dev.reservetoday.app/login | grep -oE '[a-z0-9-]+\.clerk\.accounts\.dev'`
> — a staging page must name a `*.clerk.accounts.dev` host, never `clerk.*.reservetoday.app`. The
> correct development keys are always recoverable from the running backend:
> `docker exec booking-be-staging env | grep CLERK_`.

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

**CORS:** the BE allowlist is assembled from two env vars, and the same list also backs the public-route `Origin` check and the Clerk `azp` check — see `docs/md/spec-tenant-resolution.md`. If they disagreed, one would become the hole in the other two.

- `TENANT_ORIGIN_PATTERNS` (**required**, `vars.TENANT_ORIGIN_PATTERNS`) — comma-separated tenant subdomain origins. **A tenant is created by inserting a row**, so its origin cannot be listed in advance; this is the pattern that admits a studio which did not exist when the backend was deployed. The `*` must be the **leftmost** label and covers **exactly one** label — the same boundary the certificates enforce (RFC 6125), so `a.b.reservetoday.app` is unserveable in production and is not allowlisted either. An exact origin (no `*`) is accepted too, for a host that names no tenant — e.g. the bare local `http://localhost:3000`, whose requests fall back to Tenant #1.
  - staging: `https://*.dev.reservetoday.app,https://*.portal.dev.reservetoday.app`
  - production: `https://*.reservetoday.app,https://*.portal.reservetoday.app`
  - It is also read **backwards** (`be/src/services/tenants/urls.ts`): a slug plus an app gives back the origin serving that studio, which is the base of every invitation link, member login link, account link and Stripe redirect the backend builds. That is why the link handed out and the origin the backend trusts cannot drift apart.
- `CLERK_STAFF_AUTHORIZED_PARTIES` (optional) — any extra exact origins to pin, described below.
- `PORTAL_ORIGIN` and `CLIENT_ORIGIN` are **gone**. They were one value each for the whole platform, so they could only ever name one studio's two apps — and everything built from them (staff invite links, member login links, Stripe redirects) pointed at Yoga Sadhana whichever studio the code was acting for. The wildcards already cover those two hostnames; an environment that genuinely needs an extra exact origin adds it to `TENANT_ORIGIN_PATTERNS`.

**Clerk authorized parties:** `CLERK_STAFF_AUTHORIZED_PARTIES` is **no longer passed to Clerk**. Clerk's own `authorizedParties` option is exact-match and cannot express `{slug}.portal.…` for every slug that exists — a list that would change whenever a studio is created, signing staff out of one made overnight. `verifyToken` is called without it and the `azp` claim is checked against the allowlist above instead (`be/src/lib/allowed-origins.ts`). The var still contributes any extra exact origins an environment wants to pin.

> ⚠️ **The allowlist is shared, so a wildcard in it widens `azp` too.** Adding something like `https://*.vercel.app` to `TENANT_ORIGIN_PATTERNS` for preview URLs does not affect CORS alone: it also makes every Vercel preview host a valid authorized party for staff and member tokens, and — since the list is read backwards for link bases — a candidate origin to mail people. Add preview hosts only if that tradeoff is understood.

**Clerk apps:** up to three separate Clerk applications. fe-portal + `CLERK_STAFF_*` is the staff/instructor app; fe-client + `CLERK_CLIENT_*` is the member-facing app; the super portal + `CLERK_PLATFORM_*` is optional and covered below. Cross-app tokens are rejected by the BE middleware on purpose — never share keys between them.

**Clerk sessions and cookies — why the super portal needs its own application.** Clerk's session lives in the `__client` cookie, and Clerk scopes it to the *instance's own Frontend API host*:

```
Set-Cookie: __client=…; Domain=clerk.reservetoday.app;        HttpOnly  # member app
Set-Cookie: __client=…; Domain=clerk.portal.reservetoday.app; HttpOnly  # staff app
```

Host-only, so the member app and the staff app **cannot** see each other's sessions even though both live under `reservetoday.app`. The two frontends are properly isolated and always have been.

The same rule cuts the other way for one application serving two hostnames. `admin.portal.…` and `{slug}.portal.…` are both fe-portal on the staff app, so they share one `__client` — and therefore **one signed-in person**. Signing into the super portal signs you into every studio portal as that same account. No cookie setting changes this; a second Clerk application does, because it brings a second Frontend API host and so a second `__client`.

- `CLERK_PLATFORM_PUBLISHABLE_KEY` / `CLERK_PLATFORM_SECRET_KEY` (BE) and `NEXT_PUBLIC_CLERK_PLATFORM_PUBLISHABLE_KEY` / `CLERK_PLATFORM_SECRET_KEY` / `CLERK_ENCRYPTION_KEY` (fe-portal). **All of them or none** — a partial configuration mints tokens with one instance and verifies them with another, which surfaces as a signature error or a looping login page far from the blank variable. Both sides enforce this (`be/src/lib/clerk.ts` `isPlatformAppConfigured`, `fe-portal/src/lib/clerk-keys.ts` `platformKeys`) and fall back to the shared-session behaviour rather than half-applying it.
- `CLERK_ENCRYPTION_KEY` is not optional on fe-portal once the secret is set. `clerkMiddleware()` is given the keys per request (`src/proxy.ts`), and Clerk throws from `encryptClerkRequestData` when a `secretKey` arrives without it — on the `NextResponse.next()` path, i.e. every request, `/login` included. It is part of the all-or-none guard for exactly that reason: missing it degrades to the shared session instead of 500ing the super portal.
- The hostname picks the application in two places that must agree: `<ClerkProvider publishableKey>` in `fe-portal/src/app/layout.tsx` (browser) and the `clerkMiddleware` options callback in `fe-portal/src/proxy.ts` (server). Both read `fe-portal/src/lib/clerk-keys.ts`.
- Leaving it unset is supported and is the pre-existing behaviour: the super portal shares the staff app's session. The BE warns at boot. `PLATFORM_ADMIN_EMAILS` remains the authorisation either way — this only decides whether the two hostnames can hold two different sessions in one browser.
- Set it and a studio superadmin's staff token no longer reaches the allowlist at all: it was signed by a different Clerk instance and fails verification.

> Turning this on **signs every super portal operator out once**, and the new application starts with an empty user pool. `npm run db:seed` provisions it — the seeder follows the same `isPlatformAppConfigured()` question, so it creates each `PLATFORM_ADMIN_EMAILS` address in whichever app the super portal actually reads, and names that app in its output. Operators then set their own password via "Forgot password", as they did on the staff app. Do it in a maintenance window, staging first.

> `__client_uat` *is* set on the registrable domain (`Domain=reservetoday.app`), so every app on the domain shares it. It carries no identity — it is the "is anyone signed in?" hint clerk-js checks before a handshake — and each instance also writes a suffixed copy, `__client_uat_<hash>`, which is the one modern clerk-js reads. A stale suffix from a retired instance is harmless but never expires on its own; clearing site data for `reservetoday.app` is the only way to remove one.

> **Adding a record under a host a wildcard currently serves breaks that host — pin it in the same
> change.** RFC 4592: a wildcard does not reach past a node that exists, and creating
> `x.foo.example` makes `foo.example` exist as an empty non-terminal even though nothing was
> written at it. This zone has now been bitten three times. `*.portal.reservetoday.app` broke the
> moment the Clerk `clerk.portal` / `accounts.portal` records were added; `*.dev` and `*.portal.dev`
> had to be explicit because `api.dev` already made `dev` a node; and the super portal's own Clerk
> domain repeated it exactly (below). Treat it as a rule, not a surprise.
>
> **The super portal's Clerk domain needs five records of its own, plus a sixth for the site.**
> The third Clerk application (#81) is a production instance on `admin.portal.reservetoday.app`, so
> its `pk_live_` decodes to the Frontend API host `clerk.admin.portal.reservetoday.app` — and that
> host had **no record at all**. It resolved through `*.portal` to Vercel, the TLS handshake failed,
> and the sign-in card spun forever with no error anywhere. The instance's five required CNAMEs
> (`clerk`, `accounts`, `clkmail`, `clk._domainkey`, `clk2._domainkey`, all prefixed
> `.admin.portal`) are readable from `GET https://api.clerk.com/v1/domains` with that app's secret
> key, which is faster than the dashboard. Adding them makes `admin.portal.reservetoday.app` an
> empty non-terminal, so an explicit `admin.portal` CNAME to Vercel has to go in **first** or the
> super portal itself disappears behind the same rule. Certificate issuance is not instant; it
> completes after the instance's domain is verified in the Clerk dashboard.

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
- `env vars` (set in **both** Environments): `PORT`, `TENANT_ORIGIN_PATTERNS`, `SUPERADMIN_EMAIL`, `PLATFORM_ADMIN_EMAILS` (optional), `MAIL_FROM_EMAIL` / `MAIL_FROM_NAME` (optional — the platform's envelope identity; see below)
- `org secrets`: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`
- `repo/env secrets`: `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_APP_PASSWORD`, `DOCKERHUB_TOKEN`, `SSH_PRIVATE_KEY`, `CLERK_STAFF_*` (×3), `CLERK_CLIENT_*` (×3), `SMTP_USER`, `SMTP_PASSWORD`, `SENTRY_DSN` (optional — error monitoring), `R2_*` (×5 — required in **both** Environments; see the `R2_PUBLIC_URL` note above), plus deferred `STRIPE_*`.
- `NODE_ENV` (always `production`), `APP_ENV`, `ENV_NAME`, `STACK_DIR`, `BOOKING_FQDN` and `IMAGE_TAG` are derived from the branch in the workflow's `env:` block, not from repo settings.
- `ENABLE_JOBS` is hardcoded `true` in the workflow — the background cron jobs (`be/src/jobs/index.ts`) are not optional on a deployed server. With it off, pending PT requests never expire and members' session credits are never auto-refunded.

**Two database connections, and why.** `DATABASE_URL` is the owner role (`DB_USER`) and is used for migrations and seeds only. The running server connects with `DATABASE_APP_URL`, built from `DB_APP_PASSWORD` for the `booking_app` role that `npm run db:migrate` provisions (`be/src/db/roles.ts`). This is not cosmetic: Postgres exempts superusers and table owners from Row-Level Security, so pointing the server at `DATABASE_URL` would leave the tenant policies (migration 0033) enforcing nothing while every request still succeeded. **`DB_APP_PASSWORD` must be set as an environment secret in BOTH `staging` and `Production` before the first deploy carrying this change** — without it the backend fails Zod validation at boot, which is the intended failure for a missing security control. The reasoning is recorded in `docs/adr/0002-shared-schema-row-level-security.md`.

**Outbound mail leaves on one envelope, and it must be one the credentials own.** Every tenant's transactional mail is sent through the single Gmail account behind `SMTP_USER`, wearing that tenant's display name and its own `Reply-To` — a tenant's *own* domain on the `From` line would fail that domain's SPF and DKIM, because our credentials are not authorised there. `MAIL_FROM_EMAIL` is that envelope address and defaults to `SMTP_USER` when blank; `MAIL_FROM_NAME` is shown only for a tenant with no name of its own, and defaults to `ReserveToday`. Both are optional, so a fresh Environment that sets neither boots and sends correctly. **Setting `MAIL_FROM_EMAIL` to an address the Gmail account is not a verified alias for deploys green and then fails every send at Gmail with a 5.5.1** — it is validated at boot only as a well-formed address, never as one we may send as. The decision and its upgrade path are in `docs/md/mail-identity.md`.

**Env changes must update `.github/workflows/deploy-be.yml`** whenever a BE env var is added, renamed, or removed. The workflow's required-settings comment block AND the `echo "FOO=..."` lines that write `.env.booking-be` must both match `be/src/env.ts` exactly — and `be/.env.example` should reflect the same shape. Forgetting any of these makes prod boot fail Zod validation or silently miss a value. Same rule applies to fe-client/fe-portal env: if you add a `NEXT_PUBLIC_*` var, remember it also has to be set in the Vercel project dashboard.
