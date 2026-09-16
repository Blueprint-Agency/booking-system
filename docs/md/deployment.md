# Deployment

Both frontends ship to Vercel (one Vercel project each, Root Directory pointed at the subfolder); the backend ships to a self-hosted VPS via GitHub Actions.

| App | Target | How it deploys |
|---|---|---|
| `fe-client/` | Vercel project `booking-system` (Root Directory = `fe-client/`) | `main` → `https://{slug}.reservetoday.app` (wildcard `*.reservetoday.app`); `staging` → `https://{slug}.dev.reservetoday.app` (wildcard `*.dev.reservetoday.app`). Env vars: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ROOT_DOMAIN`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_APP_ENV` — set **twice**, once per scope (Production / Preview). Members sign in through the backend's Better Auth `client` pool, and so does a superadmin impersonating one, so nothing auth-related is set here. |
| `fe-portal/` | Vercel project `booking-system-admin` (Root Directory = `fe-portal/`) | `main` → `https://{slug}.portal.reservetoday.app` (wildcard `*.portal.reservetoday.app`); `staging` → `https://{slug}.portal.dev.reservetoday.app`. Same env shape as fe-client, with its own `NEXT_PUBLIC_ROOT_DOMAIN` (the `portal.` one). Staff and the super portal sign in through the backend's `staff` / `platform` pools, so nothing auth-related is set here either. |
| `cdn/` | Vercel project `booking-cdn` (Root Directory = `cdn/`) | Edge proxy fronting the R2 bucket at `https://cdn.reservetoday.app`. One env var, `R2_ORIGIN`, the bucket's `pub-<hash>.r2.dev` URL. No DNS record needed — the zone's `*` ALIAS already resolves the name. **Not Git-connected**: deployed with `vercel deploy --prod` from `cdn/`, not on push. |
| `be/` | bpvps2 (Docker) | Auto-deploy on push to `staging` **or** `main` (paths-filtered to `be/**`), **only after the backend test suite passes** — see [Tests gate the backend deploy](#tests-gate-the-backend-deploy). `.github/workflows/deploy-be.yml` builds the image, pushes to Docker Hub (`blueprintagency/booking-be`), SSHes to bpvps2 over Tailscale, writes `.env.booking-be` from the branch's GitHub Environment, and runs migrate/seed + `docker compose up -d`. |

**Deploy branch & environments:** two live environments, one per branch.

| | `staging` branch | `main` branch |
|---|---|---|
| Backend | `booking-staging` stack on bpvps2 → `https://api.dev.reservetoday.app` | `booking-prod` stack on bpvps2 → `https://api.reservetoday.app` |
| GitHub Environment | `staging` (lowercase) | `Production` (capital P) |
| Image tag | `blueprintagency/booking-be:staging` | `…:latest` |
| fe-client | `https://{slug}.dev.reservetoday.app` | `https://{slug}.reservetoday.app` |
| fe-portal | `https://{slug}.portal.dev.reservetoday.app` | `https://{slug}.portal.reservetoday.app` |
| Super portal | `https://admin.portal.dev.reservetoday.app` | `https://admin.portal.reservetoday.app` |
| Vercel target | **preview** (branch-pinned domain) | **production** |
| `TENANT_ORIGIN_PATTERNS` | `https://*.dev.reservetoday.app,https://*.portal.dev.reservetoday.app` | `https://*.reservetoday.app,https://*.portal.reservetoday.app` |
| Auth | the staging backend's own three Better Auth pools (`/api/v1/auth/{client,staff,platform}`) | the production backend's own three pools — separate databases, so separate users and sessions |
| `APP_ENV` / `NEXT_PUBLIC_APP_ENV` | `staging` | `production` |

> **Every pre-tenancy hostname is gone.** The table above is now the whole list: nothing outside
> it answers on `reservetoday.app`. Three rows were deleted from the Vercel projects, and each is
> named here because a 404 with no explanation is how someone rediscovers a URL we retired on
> purpose:
>
> | Removed | Was | Use instead |
> |---|---|---|
> | `portal.{slug}.reservetoday.app` | 301 → `{slug}.portal.…` | `{slug}.portal.reservetoday.app` |
> | `staging-portal.{slug}.reservetoday.app` | live, `staging` branch | `{slug}.portal.dev.reservetoday.app` |
> | `staging.{slug}.reservetoday.app` | live, `staging` branch | `{slug}.dev.reservetoday.app` |
>
> (Each existed for exactly one studio, since they predate wildcards; `{slug}` above stands for
> that studio's own label.)
>
> The two `staging-*` rows were the worse of the three. They were branch-assigned domains from the
> pre-tenancy scheme, so they served the **staging** build — staging auth, dev API — from a
> hostname that reads as production. A bookmark to one looked like the live studio and was not.
>
> `portal.{slug}.…` had been a 301 rather than a live host, added when the portal URL flipped.
> The redirect went too: a redirect is still a hostname to keep, certify and explain, and the flip
> is old enough that a 404 is the more honest answer.
>
> Nothing was needed on the backend for any of it. A removal only stops Vercel
> answering for a name; `TENANT_ORIGIN_PATTERNS` and every link the backend
> builds already named the `{slug}.[portal.][dev.]reservetoday.app` forms and nothing else.
>
> The first studio's own `{slug}.portal.reservetoday.app` row went with them. It had been attached explicitly only
> because Vercel refuses to redirect to a host the project does not own; once the redirect was
> deleted the row was a per-Tenant domain sitting in a project that is supposed to have none.
> `*.portal.reservetoday.app` covers it, exactly as it covers every other studio — verified live
> after the removal.
>
> **Every domain row on both projects is now a wildcard**, which is the invariant worth naming:
> **provisioning a studio adds no Vercel domain.** The super portal is covered by the same
> `*.portal.…` wildcard as the studios — `admin` is simply a label the app recognises
> (`isSuperPortalHost`), not a hostname Vercel knows about.
>
> | Project | Rows |
> |---|---|
> | `booking-system` | `*.reservetoday.app` · `*.dev.reservetoday.app` (branch `staging`) |
> | `booking-system-admin` | `*.portal.reservetoday.app` · `*.portal.dev.reservetoday.app` (branch `staging`) |
> | `booking-cdn` | `cdn.reservetoday.app` |
>
> **`staging.reservetoday.app` is not a legacy hostname** and was left alone. It matches no project
> domain of its own; `staging` is in `NON_TENANT_LABELS` (`fe-client/src/lib/tenant-host.ts`,
> mirroring `be/src/services/tenants/slug.ts`), so the client wildcard serves it the same
> no-Tenant page it serves `www.` and `app.`. An unknown slug still 404s.

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

### Tests gate the backend deploy

`deploy-be.yml` runs a `test` job before `deploy`, and `deploy` declares `needs: test`. A red
backend suite means no image is built and neither stack is touched.

- **What runs.** The whole backend suite (`be/src/**/*.test.ts`) against a throwaway `postgres:16`
  service container, with `TEST_DATABASE_URL` pointing at it and the same stub environment the
  integration harness (`be/src/test/harness.ts`) fills in — `src/env.ts` validates at import, so
  unit tests need it too.
- **Serially** (`--test-concurrency=1`). The suite is green serially and flaky in parallel: the RLS
  coverage test's probe table races the transfer test's table count. Serial is the gate; fixing the
  flake is separate work.
- **Skips fail the job.** The integration tests skip themselves when `TEST_DATABASE_URL` is unset,
  and a skipped test counts as a pass. Nothing else in the suite skips, so the job fails unless the
  TAP summary reads `# skipped 0` — a broken CI env cannot turn the gate green by testing nothing.
- **Pull requests** into `staging` or `main` run the same tests and never deploy. A push that only
  touches a frontend does not run the backend tests or deploy (a `changes` job filters by path).
  A manual `workflow_dispatch` always runs the tests, then deploys.
- **Same Node as the image.** The `test` job runs on the Node major `be/Dockerfile` ships (22) and
  fails at once if the two drift apart — bump both together.

**Frontend checks are advisory.** The same workflow runs `npm run check` in `fe-client/` and
`fe-portal/` when their paths change, so a broken frontend test shows a red check on the commit or
PR. But Vercel deploys the frontends itself and **does not wait for GitHub checks** — a red frontend
check does not stop a Vercel deploy. That is a deliberate launch decision; look at the check before
merging.

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
> than racing. Queueing is the fix, not the cost.
>
> **Only one deploy can wait at a time.** GitHub keeps a single pending run per concurrency group.
> `cancel-in-progress: false` protects the deploy that is *running*, not the one that is waiting:
> if a third deploy queues while one runs and one waits, the waiting one is **cancelled** and the
> newest takes its place, whatever branch either is on. So a `staging` push can cancel a waiting
> `main` deploy, and production quietly stays on the old build. A cancelled deploy does not come
> back by itself — **re-run it** (Actions → the cancelled run → *Re-run all jobs*). After a burst of
> pushes, check that the latest `main` run's `deploy` job actually finished.
>
> If you ever see that error anyway: re-run the failed job once the other one has finished, and
> **check the running image against the tag** before assuming it recovered —
> `docker inspect booking-be-prod --format '{{.Image}}'` against
> `docker image inspect blueprintagency/booking-be:latest --format '{{.Id}}'`. A healthy container
> is not evidence of a current one.

### Every deploy snapshots the database before it migrates

Immediately before `db:migrate`, the deploy runs the host's backup job for the instance it is
about to migrate — `docker exec backup /app/bin/backup.sh booking-staging` on `staging`,
`booking-prod` on `main` — and **stops before migrating** unless that snapshot succeeded. The
snapshot is encrypted, in R2, and kept at least 7 days, so a migration that breaks data is
reversible:

```bash
ssh bp-bpvps2
docker exec backup restic snapshots --tag booking-staging    # the one just before the bad deploy
docker exec backup /app/bin/restore-live.sh booking-staging <id> --confirm booking-staging
```

Both branches, on purpose: `booking-staging` holds the real member data. The backup job, the
restore command and what it does are the infrastructure repo's
[`docs/backup-restore.md`](https://github.com/Blueprint-Agency/infrastructure/blob/main/docs/backup-restore.md).
A deploy failing with `Pre-migration snapshot FAILED (backup.sh exit 2)` most often met the
nightly backup (03:30 KL) mid-run: re-run it.

> **Every staging/production URL is a real domain — do not test against `*.vercel.app`.**
> The generated aliases still exist and still resolve, but the backend's CORS allowlist contains
> only the exact origins and the Tenant wildcard patterns above, so a `.vercel.app` alias fails
> every API call. The trap is
> `booking-system-admin-git-main-….vercel.app`: it reads like a dev URL but `-git-main-` is the
> **production** build, so it fails on CORS against the production API. Vercel truncates the
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

> **Check which backend a deployed page actually calls — the Preview scope has been wrong
> before** (it once signed staging in against production auth). Sign-in goes to
> `NEXT_PUBLIC_API_URL`, so on the **Preview** scope of both projects it must read
> `https://api.dev.reservetoday.app`; a staging page whose sign-in request goes to
> `api.reservetoday.app` is using production accounts.

Notes:

- The port is stripped from both sides of the comparison, so a dev server on another port still
  resolves Tenants.
- Locally, `*.localhost` reaches loopback in Chrome, Edge and Firefox with **no hosts-file entry**,
  multi-level names included — `acme.localhost:3000` and `acme.portal.localhost:3001` just work.
  Safari does not do this; Safari users add `127.0.0.1 acme.localhost` or use `lvh.me`.
- **Browse a studio's subdomain, not the bare host.** `northwind.localhost:3000` and
  `northwind.portal.localhost:3001` (the seeded fixture studios are `northwind` and `acme`),
  never `localhost:3000` / `localhost:3001` — the bare host is
  the root domain, so it names no Tenant and the API answers `400 tenant_required`. This was
  survivable while a tenant-less request silently became tenant #1; that fallback is gone
  (`docs/md/spec-tenant-resolution.md` § Resolve), so the bare host now fails loudly instead of
  quietly showing one studio's data.
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

**CORS:** the BE allowlist is assembled from one env var, and the same list also backs the public-route `Origin` check and the auth pools' trusted origins — see `docs/md/spec-tenant-resolution.md`. If they disagreed, one would become the hole in the other two.

- `TENANT_ORIGIN_PATTERNS` (**required**, `vars.TENANT_ORIGIN_PATTERNS`) — comma-separated tenant subdomain origins. **A tenant is created by inserting a row**, so its origin cannot be listed in advance; this is the pattern that admits a studio which did not exist when the backend was deployed. The `*` must be the **leftmost** label and covers **exactly one** label — the same boundary the certificates enforce (RFC 6125), so `a.b.reservetoday.app` is unserveable in production and is not allowlisted either. An exact origin (no `*`) is accepted too, for a host that names no tenant — e.g. the bare local `http://localhost:3000` — or any extra origin an environment needs to pin.
  - staging: `https://*.dev.reservetoday.app,https://*.portal.dev.reservetoday.app`
  - production: `https://*.reservetoday.app,https://*.portal.reservetoday.app`
  - It is also read **backwards** (`be/src/services/tenants/urls.ts`): a slug plus an app gives back the origin serving that studio, which is the base of every invitation link, member login link, account link and Stripe redirect the backend builds. That is why the link handed out and the origin the backend trusts cannot drift apart.
- `PORTAL_ORIGIN` and `CLIENT_ORIGIN` are **gone**. They were one value each for the whole platform, so they could only ever name one studio's two apps — and everything built from them (staff invite links, member login links, Stripe redirects) pointed at the first studio whichever studio the code was acting for. The wildcards already cover those two hostnames; an environment that genuinely needs an extra exact origin adds it to `TENANT_ORIGIN_PATTERNS`.

> ⚠️ **The allowlist is shared, so a wildcard in it widens auth too.** Adding something like `https://*.vercel.app` to `TENANT_ORIGIN_PATTERNS` for preview URLs does not affect CORS alone: it also makes every Vercel preview host a trusted origin for sign-in and password-reset redirects, and — since the list is read backwards for link bases — a candidate origin to mail people. Add preview hosts only if that tradeoff is understood.

**Auth:** self-hosted Better Auth, three pools on separate tables — `client` (members), `staff` (studio portals), `platform` (the super portal) — at `/api/v1/auth/{pool}`. Sessions are bearer tokens, and a studio-pool session carries the Tenant it signed in on. Two backend env vars: `BETTER_AUTH_SECRET` (environment secret, ≥32 chars; signs sessions and encrypts 2FA secrets for all three pools, so rotating it signs everyone out) and `BETTER_AUTH_URL` (derived in the workflow as `https://$BOOKING_FQDN`, the base of every link the pools mail). The frontends set nothing. See `docs/adr/0004-self-hosted-auth-with-better-auth.md`.

**The super portal signs in through the `platform` pool.** fe-portal picks the pool by hostname (`fe-portal/src/lib/auth-pool.ts`): `admin.portal.…` signs in on `/api/v1/auth/platform`, every `{slug}.portal.…` on `/api/v1/auth/staff`. The two pools are separate user tables, so a studio superadmin's email and password are refused at the super portal with no session issued, and `PLATFORM_ADMIN_EMAILS` stays the second gate on the session's email. Sessions are bearer tokens kept in each hostname's own `localStorage`, so the super portal and every studio portal hold separate sessions in one browser, and signing out of one leaves the others. There is nothing to configure on fe-portal for it; `npm run db:seed` creates each `PLATFORM_ADMIN_EMAILS` address in the platform pool without a password. The super portal's sign-in asks for the email first (`POST /api/v1/platform/sign-in/step`); an operator with no password yet is mailed the set-password link right there, and signs in once it is set.

> **Retiring Clerk (#121) — once per environment, staging first.**
>
> 1. **No user import is needed.** #120 settled on a fresh database per environment, so there are
>    no Clerk-era rows to carry across: migration 0052 finds no `clients` or `staff_users` row
>    lacking `auth_user_id` and passes, and 0053 drops `clerk_user_id` and the two `tenants`
>    organization columns. The import script is gone from the tree — it lives in git history at
>    commit `517af28` (`npm run auth:import-clerk`), kept for the record in case an environment is
>    ever restored from a Clerk-era dump instead.
> 2. **Take a database backup** before the deploy.
> 3. **Deploy at a quiet time.** The migrate step runs before the container swap, so for the
>    minute or so until the new container is up the old server still selects the dropped columns
>    and errors.
> 4. **Then clean up outside the repo:** delete every `CLERK_*` secret from both GitHub
>    Environments (`CLERK_STAFF_PUBLISHABLE_KEY`, `CLERK_STAFF_SECRET_KEY`,
>    `CLERK_STAFF_WEBHOOK_SECRET`, `CLERK_STAFF_AUTHORIZED_PARTIES`, `CLERK_CLIENT_PUBLISHABLE_KEY`,
>    `CLERK_CLIENT_SECRET_KEY`, `CLERK_CLIENT_WEBHOOK_SECRET`, `CLERK_PLATFORM_PUBLISHABLE_KEY`,
>    `CLERK_PLATFORM_SECRET_KEY`) — moving any `CLERK_STAFF_AUTHORIZED_PARTIES` value into
>    `TENANT_ORIGIN_PATTERNS` first; delete `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
>    `CLERK_SECRET_KEY` from the fe-client Vercel project, and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
>    `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PLATFORM_PUBLISHABLE_KEY` and
>    `CLERK_PLATFORM_SECRET_KEY` (and `CLERK_ENCRYPTION_KEY`, if still there) from fe-portal, both
>    scopes; remove the webhook endpoints and applications in the vendor dashboard; and remove
>    its DNS records (`clerk`, `accounts`, `clkmail`, `clk._domainkey`, `clk2._domainkey` under the
>    apex, `.portal` and `.admin.portal`). **Keep the explicit `admin.portal` CNAME to Vercel** —
>    harmless on its own, and removing it before those records are gone would hide the super
>    portal behind the rule below.

> **Adding a record under a host a wildcard currently serves breaks that host — pin it in the same
> change.** RFC 4592: a wildcard does not reach past a node that exists, and creating
> `x.foo.example` makes `foo.example` exist as an empty non-terminal even though nothing was
> written at it. This zone has been bitten three times: `*.portal.reservetoday.app` broke the
> moment records were added under `portal`; `*.dev` and `*.portal.dev` had to be explicit because
> `api.dev` already made `dev` a node; and records under `admin.portal` did the same to the super
> portal until an explicit `admin.portal` CNAME to Vercel went in first. Treat it as a rule, not a
> surprise: any record under a wildcard-served host needs that host pinned explicitly first.

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
- `env vars` (set in **both** Environments): `PORT`, `TENANT_ORIGIN_PATTERNS`, `SUPERADMIN_EMAIL`, `PLATFORM_ADMIN_EMAILS` (optional)
- `org secrets`: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`
- `repo/env secrets`: `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_APP_PASSWORD`, `DOCKERHUB_TOKEN`, `SSH_PRIVATE_KEY`, `IMPERSONATION_SECRET` (≥32 chars), `BETTER_AUTH_SECRET` (≥32 chars — required in **both** Environments; the backend fails Zod validation at boot without it), `RESEND_API_KEY`, `SENTRY_DSN` (optional — error monitoring), `R2_*` (×5 — required in **both** Environments; see the `R2_PUBLIC_URL` note above), plus deferred `STRIPE_*`.
- `NODE_ENV` (always `production`), `APP_ENV`, `ENV_NAME`, `STACK_DIR`, `BOOKING_FQDN` and `IMAGE_TAG` are derived from the branch in the workflow's `env:` block, not from repo settings. `BETTER_AUTH_URL` is derived too, as `https://$BOOKING_FQDN`.
- `ENABLE_JOBS` is hardcoded `true` in the workflow — the background cron jobs (`be/src/jobs/index.ts`) are not optional on a deployed server. With it off, pending PT requests never expire and members' session credits are never auto-refunded.

**Two database connections, and why.** `DATABASE_URL` is the owner role (`DB_USER`) and is used for migrations and seeds only. The running server connects with `DATABASE_APP_URL`, built from `DB_APP_PASSWORD` for the `booking_app` role that `npm run db:migrate` provisions (`be/src/db/roles.ts`). This is not cosmetic: Postgres exempts superusers and table owners from Row-Level Security, so pointing the server at `DATABASE_URL` would leave the tenant policies (migration 0033) enforcing nothing while every request still succeeded. **`DB_APP_PASSWORD` must be set as an environment secret in BOTH `staging` and `Production` before the first deploy carrying this change** — without it the backend fails Zod validation at boot, which is the intended failure for a missing security control. The reasoning is recorded in `docs/adr/0002-shared-schema-row-level-security.md`.

**Outbound mail leaves on the platform's domain, and it must be one Resend has verified.** Every tenant's transactional mail is sent through Resend as `reservetoday.app`, wearing that tenant's display name and its own `Reply-To` — a tenant's *own* domain on the `From` line would fail that domain's SPF and DKIM, because Resend is not authorised there. One envelope address for members and staff alike, `noreply@reservetoday.app`, and the platform name `ReserveToday` — both constants in `be/src/lib/mailer.ts`, not env, so there is no mail identity to set per Environment. Every send goes through one paced queue that puts sign-in codes first and alerts on quota (`mail_quota_exhausted`, `mail_quota_daily_high`, `mail_quota_monthly_high` in the logs). The decision, the send gate and the upgrade path are in `docs/md/mail-identity.md`. **After deploying #153, delete the `MAIL_FROM_EMAIL`, `MAIL_FROM_PORTAL_EMAIL` and `MAIL_FROM_NAME` variables from both GitHub Environments** — nothing reads them.

**Env changes must update `.github/workflows/deploy-be.yml`** whenever a BE env var is added, renamed, or removed. The workflow's required-settings comment block AND the `echo "FOO=..."` lines that write `.env.booking-be` must both match `be/src/env.ts` exactly — and `be/.env.example` should reflect the same shape. Forgetting any of these makes prod boot fail Zod validation or silently miss a value. Same rule applies to fe-client/fe-portal env: if you add a `NEXT_PUBLIC_*` var, remember it also has to be set in the Vercel project dashboard.
