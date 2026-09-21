# Deployment

Both frontends ship to Vercel (one Vercel project each, Root Directory pointed at the subfolder); the backend ships to a self-hosted VPS via GitHub Actions.

| App | Target | How it deploys |
|---|---|---|
| `fe-client/` | Vercel project `booking-system` (Root Directory = `fe-client/`) | `main` → `https://{slug}.reservetoday.app` (wildcard `*.reservetoday.app`); `staging` → `https://{slug}.dev.reservetoday.app` (wildcard `*.dev.reservetoday.app`). Env vars: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ROOT_DOMAIN` — set **twice**, once per scope (Production / Preview). `NEXT_PUBLIC_FARO_COLLECTOR_URL` (Grafana Faro collector for browser errors and Web Vitals) is optional; unset, the app sends no telemetry. Members sign in through the backend's Better Auth `client` pool, and so does a studio admin impersonating one, so nothing auth-related is set here. |
| `fe-portal/` | Vercel project `booking-system-admin` (Root Directory = `fe-portal/`) | `main` → `https://{slug}.portal.reservetoday.app` (wildcard `*.portal.reservetoday.app`); `staging` → `https://{slug}.portal.dev.reservetoday.app`. Same env shape as fe-client, with its own `NEXT_PUBLIC_ROOT_DOMAIN` (the `portal.` one) and its own `NEXT_PUBLIC_FARO_COLLECTOR_URL`. Staff and the super portal sign in through the backend's `staff` / `platform` pools, so nothing auth-related is set here either. |
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
| `FRONTEND_URLS` | `https://*.dev.reservetoday.app,https://*.portal.dev.reservetoday.app` | `https://*.reservetoday.app,https://*.portal.reservetoday.app` |
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
> answering for a name; `FRONTEND_URLS` and every link the backend
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
- **Error catalogues match.** Before installing, the `test` job runs `scripts/check-error-codes.mjs`
  (and its unit test): the backend's `ERROR_CODES` (`be/src/shared/error-codes.ts`) and the copy in
  each frontend (`src/lib/error-codes.ts`) must list the same codes, or it names what is missing or
  extra and fails. The `fe-client` / `fe-portal` jobs run the same check, so a frontend-only change
  to its copy is caught too — there as a signal, since Vercel does not wait for it.
- **Schema drift gates it too.** A `drift` job, which `deploy` also needs, migrates an empty
  `postgres:16` from nothing and then runs `npm run db:generate`, which must answer *"No schema
  changes, nothing to migrate"* and leave `be/src/db/migrations/` untouched. A schema edit committed
  without its migration fails here. The job reads that line rather than the exit code: drizzle-kit
  exits 0 both when it writes a migration and when it crashes wanting to ask about a rename. Fix
  it on the branch with `npm run db:generate` in `be/` — `be/src/db/migrations/README.md`.

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

### Browser journeys gate the production deploy

Three golden paths run in a real browser (Playwright, `e2e/` — its own `package.json`, sharing
nothing with the apps) against **staging**:

1. A member buys a plan with a Stripe test card (`4242…`, on Stripe's hosted Checkout) and books a class.
2. An admin creates a class in the portal, and the instructor sees it on their schedule.
3. A member cancels inside the window, and the credit comes back.

`.github/workflows/e2e.yml` runs them. `deploy-be.yml` calls it as the `e2e` job on a **`main`** push
(or dispatch), and `deploy` needs it there: **red journeys mean the production backend deploy does not
start.** On `staging` the job is skipped — staging is what they run against, so a staging deploy
cannot wait on them. Before starting, the job waits for any staging deploy still in flight, then
**fails unless staging runs this commit's backend** (its `IMAGE_TAG` sha has the same `be/` as the
commit being deployed). So a commit that skipped `staging`, or whose staging deploy failed and left the
old image serving, cannot reach production on journeys that tested something else. Deploy it to
staging first, then re-run.

- **No retries.** The journeys change their studio as they go, so a second attempt meets a different
  studio. For a network blip, re-run the workflow — it makes a fresh studio.
- **A failed teardown is a warning, not a red gate.** The next run's setup sweeps what was left.
- **Manual runs use their own concurrency group**, so starting one by hand can never displace a
  queued production gate (which would skip that push's deploy, not fail it).

- **Their own studio, every run.** The job SSHes to bpvps2 and runs
  `docker compose run --rm -T booking-be npm run -s e2e:studio -- setup` in the staging stack
  (`be/src/e2e/`). That makes a studio with slug `e2e-<run>` — a prefix the super portal refuses for
  real studios (`services/tenants/slug.ts`) — with an admin, an instructor, two members on Resend's
  `delivered+…@resend.dev` sink, a plan, class types and classes. Teardown deletes every row carrying
  that studio's `tenant_id` and the auth users on those addresses, and refuses any other slug. Setup
  also sweeps e2e studios older than two hours, which a killed run leaves behind. No real studio or
  member is read or written, and production refuses the command outright.
- **Members are signed in by token.** The command registers them in-process with the null mail
  transport (it runs with `NODE_ENV=test`) and hands the journeys their session tokens; signing in by
  emailed code is not one of the journeys. Staff sign in through the portal's own form.
- **The staging image must contain `be/src/e2e/`**, since the command runs in it. A `main` deploy
  follows a staging one, so it does.
- **Run by hand:** Actions → *E2E Journeys* → *Run workflow*. Deploys nothing. On failure the run
  uploads `playwright-report` (traces, screenshots, video).
- **Run locally** against a local stack (backend + both frontends up):

  ```bash
  cd e2e && npm ci && npx playwright install chromium
  E2E_STUDIO_CMD="npm --prefix ../be run -s e2e:studio --" npx playwright test
  ```

  `E2E_KEEP_STUDIO=1` leaves the studio in place to look at afterwards.
- **Vercel is not gated.** The frontends still deploy on their own (see above); the journeys gate the
  backend image only.

### Staging matches production — the parity checklist

Compared item by item on **2026-09-17**, from the GitHub environments, the Vercel projects and the
two running stacks on bpvps2. Re-run it when an environment is added or a vendor mode changes. Every
row either matches or says why it deliberately does not.

| Item | Staging | Production | Verdict |
|---|---|---|---|
| GitHub env **variable** names | `FRONTEND_URLS`, `PLATFORM_ADMIN_EMAIL`, `PORT`, `STRIPE_STATEMENT_DESCRIPTOR_PREFIX` | same four | Match |
| GitHub env **secret** names | `BETTER_AUTH_SECRET`, `DB_APP_PASSWORD`, `DB_NAME`, `DB_PASSWORD`, `DB_USER`, `IMPERSONATION_SECRET`, `R2_*` ×5, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `SENTRY_DSN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | same sixteen | Match. **Gap:** `SENTRY_DSN` is dead in both since Sentry was removed — delete from both. |
| Vercel `booking-system` env names | Preview: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ROOT_DOMAIN`, `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_FARO_COLLECTOR_URL` (branch `staging`) | Production: same four | Match. `NEXT_PUBLIC_APP_ENV` is **live** — Faro tags every browser event with it, and it is the only thing separating staging from production inside the one Faro app. The dead `NEXT_PUBLIC_SENTRY_DSN` and `CLERK_*` entries noted here previously are gone — verified 2026-09-20, each scope now holds exactly these four. |
| Vercel `booking-system-admin` env names | Preview: the same four | Production: the same four | Match, same note on `NEXT_PUBLIC_APP_ENV`. The dead `NEXT_PUBLIC_SENTRY_DSN` and `CLERK_*` entries noted here previously are gone — verified 2026-09-20, each scope now holds exactly these four. |
| Frontend Node (Vercel) | 24.x | 24.x (same project) | Match |
| Backend image and Node | `blueprintagency/booking-be:<sha>`, Node 22.23.2 | Node 22.23.2 | Match — one Dockerfile, both built by `deploy-be.yml`. |
| Backend `.env.booking-be` key names | the current schema (`FRONTEND_URLS`, `PLATFORM_ADMIN_EMAIL`, `BETTER_AUTH_*`, …) | **stale** — still `TENANT_ORIGIN_PATTERNS`, `PLATFORM_ADMIN_EMAILS`, `ENABLE_JOBS`, `MAIL_FROM_*`, `SUPERADMIN_EMAIL`, `CLERK_*`, running image tag `latest` | **Gap, closes itself:** production has not been deployed since these renames. The next `main` deploy rewrites the file from GitHub and runs the sha. Check the key names again after it. |
| Postgres | `postgres:16-alpine`, 16.14 | `postgres:16-alpine`, 16.14 | Match |
| Role the app connects as | `booking_app` via `DATABASE_APP_URL`, `NOSUPERUSER NOBYPASSRLS` | same | Match — migrations and seeds as the owner in both. |
| CDN | `cdn.reservetoday.app` → one R2 bucket (`R2_PUBLIC_URL`) | the same host and bucket | Deliberate: one shared bucket for both (`cdn/README.md`). Keys are UUID-based so they do not collide, but deleting an object on staging deletes it for production too. The journeys upload nothing. |
| Stripe mode | test (`sk_test_…`) | **test** (`sk_test_…`) | Match today. **Deliberate difference from cutover:** production moves to a live key (and its own webhook secret) when members start paying; staging stays test forever — the journeys pay with a test card. |
| Mail sender | `noreply@reservetoday.app`, "ReserveToday" | same | Match — constants in `be/src/lib/mailer.ts`, not env. One Resend account and verified domain for both. |
| `TZ` | `Asia/Kuala_Lumpur` | `Asia/Kuala_Lumpur` | Match |
| `APP_ENV` | `staging` | `production` | Deliberate — it is the environment's name. |
| `FRONTEND_URLS`, `BETTER_AUTH_URL`, API host | `*.dev.` / `*.portal.dev.`, `api.dev.reservetoday.app` | `*.` / `*.portal.`, `api.reservetoday.app` | Deliberate — separate hostnames per environment. |
| Database contents | real studios and members until cutover, plus the Mindbody dry-run import as realistic data | real | Deliberate. No generated data goes into staging; the journeys' `e2e-` studios are removed after every run. The Mindbody dry run lands with #130. |
| Backend deploy gates | tests, drift | tests, drift, **browser journeys** | Deliberate — the journeys run against staging, so they can only gate the step after it. |

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

### Rolling back the backend

> Rolling back at 2am because something alerted? Start at
> [`observability-runbook.md`](./observability-runbook.md) — which channel the
> alert came from, which Grafana query shows you why, and the first five
> commands (this rollback is the fourth).

The deploy still pushes two tags — the floating `staging` / `latest` and the commit sha — but the
stack runs **the sha**. After the new image passes its smoke test, the deploy writes it into the
stack's `.env` as `IMAGE_TAG`, and moves the sha that was there to `PREVIOUS_IMAGE_TAG`. The deploy
log prints both. So rolling the code back is one edit:

```bash
ssh bp-bpvps2
cd /root/stacks/booking-staging          # booking-prod for production
grep IMAGE_TAG .env                      # IMAGE_TAG=<bad sha>  PREVIOUS_IMAGE_TAG=<good sha>
# swap the two values
sed -i -e 's/^IMAGE_TAG=/SWAP_IMAGE_TAG=/' -e 's/^PREVIOUS_IMAGE_TAG=/IMAGE_TAG=/' \
       -e 's/^SWAP_IMAGE_TAG=/PREVIOUS_IMAGE_TAG=/' .env
docker compose up -d
docker compose ps                        # booking-be healthy, on the good sha
```

Rolling forward again is the same swap. So is the next normal deploy, which writes its own sha and
keeps whatever was running as `PREVIOUS_IMAGE_TAG`.

- **This moves the code, never the data.** The rolled-back image runs against the database the
  bad deploy already migrated. That is safe only because migrations only add (the golden rule in
  `be/src/db/migrations/README.md`): an older build ignores a column it does not know. If the
  migration itself broke data, the way back is the pre-migrate snapshot above
  (`restore-live.sh`), not this.
- **The first deploy after this change** records the floating tag the stack was on (`staging` or
  `latest`) as `PREVIOUS_IMAGE_TAG`. On Docker Hub that tag already names the new build, so a
  rollback to it lands on the old image only until anything re-pulls — do not count on it. There is
  a real way back from the second deploy on.
- A re-run of the same commit leaves `PREVIOUS_IMAGE_TAG` alone; a deploy that fails before the
  smoke test passes does not touch either value.

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

`NODE_ENV` stays `production` on any server/build, incl. Vercel previews (build flag — enables optimizations + JSON logging); the backend's environment NAME lives in `APP_ENV`.

> **`booking-staging` carries the real data.** It predates `booking-prod`, which is a fresh
> database. Migrating that data is a separate job — don't assume prod is populated.

> There is no `vercel.json` in either frontend on purpose. Vercel's defaults already give
> `main` → production and every other branch → preview; a `git.deploymentEnabled` block existed
> only while `main` was intentionally dead, and re-adding one silently disables a branch.

> The BE Traefik router matches a **full** hostname (`BOOKING_FQDN`), not `${BOOKING_HOST}.${BASE_DOMAIN}` —
> bpvps2's host-wide `BASE_DOMAIN` is `teeko.ai` and cannot express `reservetoday.app`. The compose
> lives in the infra repo at `vps/bpvps2/stacks/booking/docker-compose.yml`.

**CORS:** the BE allowlist is assembled from one env var, and the same list also backs the public-route `Origin` check and the auth pools' trusted origins — see `docs/md/spec-tenant-resolution.md`. If they disagreed, one would become the hole in the other two.

- `FRONTEND_URLS` (**required**, `vars.FRONTEND_URLS`) — comma-separated tenant subdomain origins. **A tenant is created by inserting a row**, so its origin cannot be listed in advance; this is the pattern that admits a studio which did not exist when the backend was deployed. The `*` must be the **leftmost** label and covers **exactly one** label — the same boundary the certificates enforce (RFC 6125), so `a.b.reservetoday.app` is unserveable in production and is not allowlisted either. An exact origin (no `*`) is accepted too, for a host that names no tenant — e.g. the bare local `http://localhost:3000` — or any extra origin an environment needs to pin.
  - staging: `https://*.dev.reservetoday.app,https://*.portal.dev.reservetoday.app`
  - production: `https://*.reservetoday.app,https://*.portal.reservetoday.app`
  - It is also read **backwards** (`be/src/services/tenants/urls.ts`): a slug plus an app gives back the origin serving that studio, which is the base of every invitation link, member login link, account link and Stripe redirect the backend builds. That is why the link handed out and the origin the backend trusts cannot drift apart.
- `PORTAL_ORIGIN` and `CLIENT_ORIGIN` are **gone**. They were one value each for the whole platform, so they could only ever name one studio's two apps — and everything built from them (staff invite links, member login links, Stripe redirects) pointed at the first studio whichever studio the code was acting for. The wildcards already cover those two hostnames; an environment that genuinely needs an extra exact origin adds it to `FRONTEND_URLS`.

> ⚠️ **The allowlist is shared, so a wildcard in it widens auth too.** Adding something like `https://*.vercel.app` to `FRONTEND_URLS` for preview URLs does not affect CORS alone: it also makes every Vercel preview host a trusted origin for sign-in and password-reset redirects, and — since the list is read backwards for link bases — a candidate origin to mail people. Add preview hosts only if that tradeoff is understood.

**Auth:** self-hosted Better Auth, three pools on separate tables — `client` (members), `staff` (studio portals), `platform` (the super portal) — at `/api/v1/auth/{pool}`. Sessions are bearer tokens, and a studio-pool session carries the Tenant it signed in on. Two backend env vars: `BETTER_AUTH_SECRET` (environment secret, ≥32 chars; signs sessions and encrypts 2FA secrets for all three pools, so rotating it signs everyone out) and `BETTER_AUTH_URL` (derived in the workflow as `https://$BOOKING_FQDN`, the base of every link the pools mail). The frontends set nothing. See `docs/adr/0004-self-hosted-auth-with-better-auth.md`.

**The super portal signs in through the `platform` pool.** fe-portal picks the pool by hostname (`fe-portal/src/lib/auth-pool.ts`): `admin.portal.…` signs in on `/api/v1/auth/platform`, every `{slug}.portal.…` on `/api/v1/auth/staff`. The two pools are separate user tables, so a studio staff member's email and password are refused at the super portal with no session issued, and `PLATFORM_ADMIN_EMAIL` stays the second gate on the session's email. Sessions are bearer tokens kept in each hostname's own `localStorage`, so the super portal and every studio portal hold separate sessions in one browser, and signing out of one leaves the others. There is nothing to configure on fe-portal for it; `npm run db:seed` creates each `PLATFORM_ADMIN_EMAIL` address in the platform pool without a password. The super portal's sign-in asks for the email first (`POST /api/v1/platform/sign-in/step`); an operator with no password yet is mailed the set-password link right there, and signs in once it is set.

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
>    `FRONTEND_URLS` first; delete `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
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
- `env vars` (set in **both** Environments): `PORT`, `FRONTEND_URLS`, `PLATFORM_ADMIN_EMAIL` (optional), `LOG_LEVEL` (optional; blank = `info`), `STRIPE_STATEMENT_DESCRIPTOR_PREFIX` (see below)
- `org secrets`: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`
- `repo/env secrets`: `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_APP_PASSWORD`, `DOCKERHUB_TOKEN`, `SSH_PRIVATE_KEY`, `IMPERSONATION_SECRET` (≥32 chars), `BETTER_AUTH_SECRET` (≥32 chars — required in **both** Environments; the backend fails Zod validation at boot without it), `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` (the `whsec_…` signing secret of the Resend webhook pointed at `/api/v1/webhooks/resend`; unset, that route answers "not configured"), `R2_*` (×5 — required in **both** Environments; see the `R2_PUBLIC_URL` note above), `PAYMENT_CREDENTIALS_KEY` (optional — see below), plus deferred `STRIPE_*`.
- `NODE_ENV` (always `production`), `APP_ENV`, `ENV_NAME`, `STACK_DIR`, `BOOKING_FQDN` and `IMAGE_TAG` are derived from the branch in the workflow's `env:` block, not from repo settings. `BETTER_AUTH_URL` is derived too, as `https://$BOOKING_FQDN`. The workflow's `IMAGE_TAG` is the floating tag it pushes (`staging` / `latest`); the stack's own `.env` on the host gets the commit sha instead — see [Rolling back the backend](#rolling-back-the-backend).
- The background cron jobs (`be/src/jobs/index.ts`) always start with the server — there is no env switch. Without them, pending PT requests never expire and members' session credits are never auto-refunded. Every server process runs them, so run one backend instance per database.

**Two database connections, and why.** `DATABASE_URL` is the owner role (`DB_USER`) and is used for migrations and seeds only. The running server connects with `DATABASE_APP_URL`, built from `DB_APP_PASSWORD` for the `booking_app` role that `npm run db:migrate` provisions (`be/src/db/roles.ts`). This is not cosmetic: Postgres exempts superusers and table owners from Row-Level Security, so pointing the server at `DATABASE_URL` would leave the tenant policies (migration 0033) enforcing nothing while every request still succeeded. **`DB_APP_PASSWORD` must be set as an environment secret in BOTH `staging` and `Production` before the first deploy carrying this change** — without it the backend fails Zod validation at boot, which is the intended failure for a missing security control. The reasoning is recorded in `docs/adr/0002-shared-schema-row-level-security.md`.

**Outbound mail leaves on the platform's domain, and it must be one Resend has verified.** Every tenant's transactional mail is sent through Resend as `reservetoday.app`, wearing that tenant's display name and its own `Reply-To` — a tenant's *own* domain on the `From` line would fail that domain's SPF and DKIM, because Resend is not authorised there. One envelope address for members and staff alike, `noreply@reservetoday.app`, and the platform name `ReserveToday` — both constants in `be/src/lib/mailer.ts`, not env, so there is no mail identity to set per Environment. Every send goes through one paced queue that puts sign-in codes first and alerts on quota (`mail_quota_exhausted`, `mail_quota_daily_high`, `mail_quota_monthly_high` in the logs). The decision, the send gate and the upgrade path are in `docs/md/mail-identity.md`. **After deploying #153, delete the `MAIL_FROM_EMAIL`, `MAIL_FROM_PORTAL_EMAIL` and `MAIL_FROM_NAME` variables from both GitHub Environments** — nothing reads them.

**`STRIPE_STATEMENT_DESCRIPTOR_PREFIX` must match the prefix set on the Stripe account that Environment uses.** Every studio charges on one shared Stripe account, so the only per-charge text Stripe allows is a descriptor *suffix* — the studio's name — appended to the account's fixed prefix as `PREFIX* SUFFIX`, 22 characters for the pair. Stripe refuses a suffix unless the account actually has a prefix configured, so the backend needs to be told what it is; it is configuration rather than a value read back per process (`be/src/lib/stripe.ts` says why).

**What happens when it does not match, or is not set.** The suffix is dropped and every studio's charges carry the platform's own default descriptor — a name the member has never seen on their statement, which is a chargeback. This never fails a charge: a member's payment is worth more than a statement line, so the checkout path stays silent by design. Instead the backend says it **at boot**, once, when `STRIPE_SECRET_KEY` is set and the prefix is missing, blank, or so long it leaves no room for a suffix: a `payments misconfigured — …` line at `error` level in `docker compose logs booking-be`. Setting the variable to a value the Stripe account does *not* have configured is the one case nothing catches — the boot check sees a plausible prefix and Stripe silently drops the suffix — so verify the account setting when you change either.

Order of operations on a fresh environment: activate the Stripe account (`card_payments` is inactive until it is, and the prefix is a card-payments setting) → set the prefix on the account → mirror it into the GitHub Environment variable.

A studio selling on **its own** payment account sends no suffix at all: the 22-character budget is measured against a prefix configured on that studio's account, which this platform cannot read, and a refused charge costs the sale.

**`PAYMENT_CREDENTIALS_KEY` seals a studio's own payment credentials.** A studio may charge on **its own** payment-provider account rather than the platform's (#100, `be/docs/adr/0004-tenant-supplied-payment-credentials.md`): it supplies its secret key and webhook signing secret, the super portal stores them encrypted, and every call on that studio's behalf is made against that account. This variable is the encryption key — base64, exactly 32 bytes, `openssl rand -base64 32`.

It is **optional and unset is a working state**: every studio then charges on `STRIPE_SECRET_KEY`'s account, exactly as before, and the super portal answers `503 secret_storage_unavailable` rather than storing anything in the clear. What it must not be is *changed*: rotating it orphans every stored credential, and each studio's have to be entered again — there is deliberately no second key to fall back to.

Onboarding one studio has a second half nothing here can check. Its account must have a webhook endpoint pointing at **`https://api.<root domain>/api/v1/webhooks/stripe/{slug}`** — its own URL, because its account signs with its own secret and the URL is what selects which secret to verify against. The super portal shows that URL immediately after the credentials are saved. Until the endpoint exists on the studio's account, its members are charged and nothing is granted. The shared `/api/v1/webhooks/stripe` endpoint stays exactly as it is, for every studio still on the platform account.


**Env changes must update `.github/workflows/deploy-be.yml`** whenever a BE env var is added, renamed, or removed. The workflow's required-settings comment block AND the `echo "FOO=..."` lines that write `.env.booking-be` must both match `be/src/env.ts` exactly — and `be/.env.example` should reflect the same shape, and the [Secret rotation](#secret-rotation) table should gain its row. Forgetting any of these makes prod boot fail Zod validation or silently miss a value. Same rule applies to fe-client/fe-portal env: if you add a `NEXT_PUBLIC_*` var, remember it also has to be set in the Vercel project dashboard.

### Secret rotation

Every value the three apps and their deploy read. No values here — only where each lives and what
it costs to change. "GH env" is the branch's GitHub Environment (`staging` / `Production`, set in
both); "GH org" is the Blueprint-Agency organization; "host `.env`" is `.env.booking-be` on bpvps2,
which the deploy **rewrites from GitHub on every run** — so a backend secret is rotated in GitHub
and takes effect on the next deploy, never by editing the host file (it would be overwritten).

The general order for a key issued by a vendor: create the new key, set it, redeploy, check, *then*
revoke the old one. Both keys work in between, so nothing breaks. The rows that cannot overlap say so.

**Secrets**

| Variable | Used by | Lives in | Rotated by | How often | What breaks while it rotates |
|---|---|---|---|---|---|
| `BETTER_AUTH_SECRET` | be | GH env → host `.env` | Backend dev | On suspected leak only | It signs every session and encrypts staff/platform authenticator-app (TOTP) secrets. **No overlap:** every member, staff and super-portal session is signed out, and authenticator apps enrolled under the old secret stop verifying — those users fall back to the emailed code and re-enrol. Rehearse on `staging` first. |
| `IMPERSONATION_SECRET` | be | GH env → host `.env` | Backend dev | On suspected leak only | Signs impersonation grants (`be/src/lib/impersonation-grant.ts`). No overlap: an impersonation in progress ends; start it again. |
| `DB_PASSWORD` (+ `DB_USER`, `DB_NAME`) | be (`DATABASE_URL`, migrations and seeds), Postgres container | GH env → host `.env` | Backend dev | Yearly, and on leak | The deploy also writes it as the container's `POSTGRES_PASSWORD`, but Postgres reads that only when its data volume is first created — so changing the secret alone breaks the next deploy's migrate step. `ALTER ROLE … PASSWORD` in the running database first, then update the secret and deploy. |
| `DB_APP_PASSWORD` | be (`DATABASE_APP_URL`, the `booking_app` role) | GH env → host `.env` | Backend dev | Yearly, and on leak | The deploy's migrate step re-sets the role's password (`be/src/db/roles.ts`) just before the new container starts, so the old container loses new connections for the seconds in between. |
| `STRIPE_SECRET_KEY` | be | GH env → host `.env` | Backend dev (Stripe account admin) | Yearly, and on leak | Roll in the Stripe dashboard with an expiry on the old key; checkout and refunds keep working until it expires. |
| `STRIPE_WEBHOOK_SECRET` | be | GH env → host `.env` | Backend dev (Stripe account admin) | On leak | Roll the endpoint's signing secret with an overlap window. Without one, webhooks fail their signature check and Stripe retries them — purchases complete late, not never. |
| `RESEND_API_KEY` | be | GH env → host `.env` | Backend dev | Yearly, and on leak | New key first. If the old one is revoked before the deploy, every mail — sign-in codes included — fails, so nobody can sign in. |
| `RESEND_WEBHOOK_SECRET` | be (`/api/v1/webhooks/resend`) | GH env → host `.env` | Backend dev | On suspected leak only | **No overlap:** Resend has one signing secret per webhook. Between rolling it in Resend and the deploy, deliveries fail verification and are retried by Resend, so bounce and complaint outcomes arrive late, not lost. Mail still sends. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | be | GH env → host `.env` | Backend dev (Cloudflare admin) | Yearly, and on leak | New token first. Revoked early, uploads fail; images already on the CDN keep loading. |
| `R2_ACCOUNT_ID` / `R2_BUCKET_NAME` / `R2_PUBLIC_URL` | be | GH env → host `.env` | — | Not rotated (identifiers) | Kept as secrets, but not credentials. Changing them moves where images are read from. |
| `DOCKERHUB_TOKEN` | deploy | GH repo | Backend dev | Yearly, and on leak | Deploys fail at image push until updated. The running app is untouched. |
| `SSH_PRIVATE_KEY` | deploy | GH repo | Backend dev (bpvps2 admin) | Yearly, and when someone with access leaves | Add the new public key to `deploy@bpvps2` before removing the old one, or deploys fail at SSH. |
| `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` | deploy | GH org | Org admin (Tailscale) | Yearly, and on leak | Deploys of every repo using them fail to join the tailnet. The running app is untouched. |
| `CF_DNS_API_TOKEN` | Traefik (shared, bpvps2) | host `.env` only — the deploy leaves it untouched | bpvps2 admin | Yearly, and on leak | Certificate issuance and renewal (DNS challenge) fail. Live certificates keep working until they expire, so there are weeks of slack. |
| `TRAEFIK_DASHBOARD_AUTH` | Traefik (shared, bpvps2) | host `.env` only | bpvps2 admin | When someone with access leaves | Dashboard login only. Needs the Traefik container restarted. |
| `R2_ORIGIN` | cdn | Vercel (`booking-cdn`) | Frontend dev | Not rotated (a URL) | Changing it points the CDN at another bucket; needs `vercel deploy --prod` from `cdn/`. |

**Configuration, not secrets** — not rotated, listed so the table covers the whole env schema
(`be/src/env.ts`) and both frontends' public values:

- be, GH env vars: `PORT`, `PLATFORM_ADMIN_EMAIL`, `FRONTEND_URLS`, `STRIPE_STATEMENT_DESCRIPTOR_PREFIX`, `LOG_LEVEL`.
- be, derived in the workflow: `NODE_ENV`, `APP_ENV`, `BETTER_AUTH_URL`, `DATABASE_URL` and `DATABASE_APP_URL` (built from the DB secrets above).
- fe-client and fe-portal, Vercel: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ROOT_DOMAIN`, `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_FARO_COLLECTOR_URL` (optional). `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_FARO_COLLECTOR_URL` also feed the CSP — see below.
- Deploy, GH org vars: `BPVPS2_TAILSCALE_HOST`, `DOCKERHUB_USERNAME`.

### Security headers

Both frontends send the same hardening headers on every response, from `headers()` in their
`next.config.ts` (policy in `src/lib/security-headers.ts`, one copy per app): HSTS (two years,
subdomains), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: DENY`, a `Permissions-Policy` that turns off camera, microphone, geolocation and
payment (a camera check-in scanner will need `camera=(self)` on the portal), and an **enforced**
Content-Security-Policy.

The CSP admits what the pages actually load: scripts, styles and fonts from their own origin; fetches
to the API origin, read from `NEXT_PUBLIC_API_URL` at **build** time — so changing it needs a Vercel
redeploy anyway; images from any `https:` host, because a studio's logo is a URL the studio owns.
Stripe needs no entry: checkout is a full-page redirect to Stripe's hosted page, and nothing loads
Stripe.js. Nothing frames the apps and they frame nothing. When `NEXT_PUBLIC_FARO_COLLECTOR_URL` is
set, its origin is admitted to `connect-src` too, also at build time.

Known gap: `script-src` still allows `'unsafe-inline'`. The App Router streams its payload in inline
scripts, and removing it means a per-request nonce set in `proxy.ts`, which renders every page
dynamically. That is the next step if the policy is to stop injected inline script, not only
off-origin script.
