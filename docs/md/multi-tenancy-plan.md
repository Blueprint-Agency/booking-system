# Multi-Tenancy Productization — Decisions & Implementation Plan

> Recorded 2026-08-31. Companion research (primary-source citations): `docs/md/research-multi-tenancy.md`.
> Status: **validated, specced, ticketed — not yet implemented.**
> Every architectural pillar is confirmed documented best practice (see "Validation record").
> Spec: **#55**. Tickets: **#56–#72**. Two items remain open; both are cheap spikes, not blockers.
> A post-publication verification pass against the codebase and the infrastructure repo produced
> four corrections — see "Verification pass" below. One of them, the Row-Level Security
> connecting-role defect, would have shipped a security control that did nothing.

## Goal

Turn the single-tenant Yoga Sadhana booking system into a productized multi-tenant SaaS
(product domain: **`reservetoday.app`**) with:

- **1 super portal** — dev team creates/manages tenants (thin CRUD; starts as a
  superadmin-gated section inside fe-portal, split into a 3rd frontend only if it grows)
- **1 portal app** — all tenants' staff, at `{tenant}.portal.reservetoday.app`
- **1 client app** — all tenants' members, at `{tenant}.reservetoday.app`

When the super portal creates a tenant, its portal + client URLs work **instantly** —
no new deployment, no DNS change, no new Clerk account.

## Core mental model (the key correction)

**Creating a tenant = inserting a DB row.** Wildcard DNS + Host-header middleware make
the URLs resolve; `tenant_id` scoping makes the data isolate. Never infra-per-tenant.

## Decisions made

| Topic | Decision |
|---|---|
| Architecture | Single shared deployment per app, single Postgres, `tenant_id` column scoping, with Postgres RLS as the fail-closed backstop. ⚠️ RLS only works if the app stops connecting as the table owner — see "Verification pass". Instance-per-tenant rejected. |
| Clerk | **2 applications forever** (client + portal), each with dev + prod instances = the 4 "projects" already in the dashboard today. Nothing to restructure; count never grows with tenants. Each tenant = a **Clerk Organization** in both apps; org ID maps to `tenant_id`. Satellite domains NOT needed (same root domain). App-per-tenant ("Clerk for Platforms") rejected — sales-gated, wrong use case. |
| Subdomain scheme | `{tenant}.reservetoday.app` → fe-client via `*.reservetoday.app`; `{tenant}.portal.reservetoday.app` → fe-portal via `*.portal.reservetoday.app`. **The label order is forced, not a preference:** RFC 4592 requires the asterisk to be the *leftmost* label, so today's `portal.{tenant}.…` shape would need `portal.*.reservetoday.app` — not a legal DNS record, therefore impossible to wildcard. ⚠️ **The live production portal URL must therefore change** (Phase 5). The fe-client production URL `yogasadhana.reservetoday.app` already matches the target scheme and does **not** change. |
| Frontends | Stay on **Vercel** (Platforms pattern: one deployment, Host-header middleware). Moving FEs to the VPS gains nothing — rejected. |
| DNS | **Option A (preferred): move `reservetoday.app` nameservers from Cloudflare to Vercel** to get true wildcards. Vercel DNS is a full DNS host — recreate `api` A record + MX/TXT there. Fallback Option B (if NS can't move): keep Cloudflare, no wildcard, super portal makes 2 API calls per tenant (Cloudflare CNAME + Vercel Domains API). |
| Backend | Stays on Hostinger VPS at `api.reservetoday.app`, as an A record in Vercel DNS. ✅ **No cert work needed** — Traefik on bpvps2 already issues a genuine Let's Encrypt cert via its `le-tls` resolver (TLS-ALPN-01), and `api*` records are already DNS-only *on purpose*, because that challenge cannot complete through a proxied host. Since the resolver needs only an A record, the NS move does not threaten the cert. |
| Cloudflare for SaaS | Only needed later, if a tenant brings their **own** custom domain (100 free hostnames, then ~$0.10/mo). Not needed for our subdomains. |
| Per-tenant auth branding | Known Clerk limitation: tenant subdomains authenticate fine, but per-tenant sign-in branding / vanity auth domains aren't supported on standard plans. Acceptable for v1 — theme our own UI around Clerk components. |
| Stripe | Per-tenant via **Stripe Connect** (payouts to each studio) rather than one shared account. |

## Validation record (2026-08-31, primary sources)

Every pillar of this plan was re-checked against vendor documentation. All confirmed:

| Claim | Verdict | Source |
|---|---|---|
| One deployment + Host-header resolution + `tenant_id` row scoping is the recommended shape | ✅ Confirmed — "One codebase, one deployment serves every tenant"; isolation guidance is literally `where: { tenantId: tenant.id }` | vercel.com/docs/platforms · /multi-tenant-platforms/concepts |
| Shared schema + `tenant_id` + RLS is current best practice | ✅ Confirmed as the 2026 default for B2B SaaS; RLS is the safety net so a missed `WHERE` fails closed | postgresql.org RLS docs · orm.drizzle.team/docs/rls · industry surveys |
| Vercel wildcard domains are available on our plan | ✅ **Resolves an UNVERIFIED item** — "**All plans**: Support for wildcard domains" | vercel.com/docs/platforms/multi-tenant-platforms/limits |
| Wildcard requires Vercel nameservers | ✅ Confirmed — required for wildcard SSL DNS challenges | same |
| `{tenant}.portal.…` ordering is mandatory | ✅ Confirmed — wildcard asterisk must be the leftmost label | RFC 4592 §2.1.1 |
| Root-domain env var + suffix-strip is the right slug algorithm | ✅ Confirmed — it is Vercel's own reference implementation (`hostname.endsWith('.'+rootDomain)` → `hostname.replace(...)`) | vercel.com/docs/platforms/examples/multi-tenant-template |
| `{tenant}.localhost:PORT` is the right local-dev shape | ✅ Confirmed — Vercel's template ships exactly this | same |
| Clerk: 2 apps forever, tenant = Organization | ✅ Confirmed | clerk.com/docs/guides/how-clerk-works/multi-tenant-architecture |
| Stripe Connect is the right payments model | ✅ Confirmed — "Build a SaaS platform: Provide platform services to businesses that collect payments from their own customers" | docs.stripe.com/connect |

**Three corrections this validation produced:**

1. **Next.js 16 renamed `middleware.ts` → `proxy.ts`.** Both frontends are already on Next 16
   (`^16.2.1` / `16.2.4`), so Phase 2 creates `proxy.ts`, exporting `proxy`, not `middleware`.
   It runs on the Node.js runtime by default — required, since tenant resolution hits the DB.
2. **Vercel wildcards are multi-level.** "any `tenant.acme.com` you create — whether it's
   `tenant1.acme.com` or `docs.tenant1.acme.com` — automatically resolves to your Vercel
   deployment." So `*.reservetoday.app` on fe-client would *also* match
   `{tenant}.portal.reservetoday.app`. This made wildcard precedence a load-bearing
   assumption → **Spike 1** below, now ✅ **resolved: precedence holds.** The multi-level claim
   is true of DNS only; TLS wildcards are single-label, so a two-label host is unserveable by
   the project holding the shorter wildcard. See Spike 1 for the evidence.
3. **RLS must be transaction-scoped under a connection pooler.** Use
   `set_config('app.current_tenant_id', $1, true)` — the `true` makes it transaction-local.
   Session-scoped config leaks tenant state between requests wherever connections are reused,
   including the backend's own pool, which would silently defeat the entire isolation model.

## Verification pass

After the spec and tickets were published, both were re-checked against the codebase and against
the infrastructure repo (`Blueprint-Agency/teeko-infrastructure`). Four corrections, folded into
spec #55 and the tickets:

**1. Row-Level Security would have been completely inert.** ⚠️ The most important finding on this
page. `deploy-be.yml` writes the same `DB_USER` into both `DATABASE_URL` and `POSTGRES_USER`, so
the backend connects as the role that **owns the tables and is a superuser**. Postgres table
owners bypass RLS, and superusers bypass it even with `FORCE ROW LEVEL SECURITY`. Enabling
policies without changing the connecting role yields a control that does nothing — and every
isolation test still passes, which is what makes it dangerous. The fix is a dedicated
non-superuser, non-owning application role, with migrations still run by the owner, and one test
that **fails if the role is reverted**. Adding it means a new env var and a new GitHub Environment
secret in both environments.

**2. The frontend proxy may not query the database.** Vercel's reference implementation resolves
the tenant with a direct DB call from the proxy, and that pattern was carried across unchecked.
`CLAUDE.md` requires the three apps stay fully decoupled with no shared dependencies, and
`CONTEXT-MAP.md` states the frontends reach the backend over HTTP only. The backend therefore
exposes a public, cacheable slug-resolution route and the proxy calls it — which makes the cache
and the backend-outage behaviour load-bearing, since it sits on every request.

**3. Webhooks cannot resolve a tenant, and it needs a decision.** The Clerk webhook is one
endpoint serving both Clerk apps; its own comments note the payload cannot identify the app, only
the signing secret can. Multi-tenancy repeats that a level deeper: `user.created` carries no
organization, yet the handler inserts a row that will need a `tenant_id`. Options are organization
events instead of user events, tenant in sign-up metadata, or an endpoint per tenant — they differ
for a member of two studios, so the choice must be recorded rather than defaulted into.

**4. Policies and context must land in the same change.** The moment RLS is enabled, every query
needs a tenant setting present or `current_setting` errors and the app returns nothing. HTTP-level
resolution arrives a ticket later, so the DB layer must set context in the same change that
switches policies on.

Three environment gaps were also closed in the tickets: the root-domain variable was never set in
the Vercel dashboard, staging never got a second tenant, and the restricted DB credential needed a
GitHub Environment secret.

## Environments & URL scheme

### The single rule

Don't model three URL schemes — model **one env var and one operation**:

```
NEXT_PUBLIC_ROOT_DOMAIN = everything after the tenant slug
slug = hostname (port stripped) minus that suffix
```

Every environment is just a different value. The resolution code is byte-identical
everywhere, which is the point: a Host-parsing bug that only manifests in production is the
worst failure mode this project has. (This is Vercel's own reference algorithm — see above.)

| | fe-client `ROOT_DOMAIN` | fe-portal `ROOT_DOMAIN` |
|---|---|---|
| Local | `localhost:3000` | `portal.localhost:3001` |
| Staging | `dev.reservetoday.app` | `portal.dev.reservetoday.app` |
| Production | `reservetoday.app` | `portal.reservetoday.app` |

### Full URL map

Tenants shown: `yogasadhana` (tenant #1) and `acme` (synthetic second tenant).

| | Local | Staging | Production |
|---|---|---|---|
| **Client** | `yogasadhana.localhost:3000`<br>`acme.localhost:3000` | `yogasadhana.dev.reservetoday.app`<br>`acme.dev.reservetoday.app` | `yogasadhana.reservetoday.app`<br>`acme.reservetoday.app` |
| **Portal** | `yogasadhana.portal.localhost:3001` | `yogasadhana.portal.dev.reservetoday.app` | `yogasadhana.portal.reservetoday.app` |
| **Super portal** | `admin.portal.localhost:3001` | `admin.portal.dev.reservetoday.app` | `admin.portal.reservetoday.app` |
| **API** | `localhost:4000` | `api.dev.reservetoday.app` | `api.reservetoday.app` |
| **Wildcards** | — (browser handles `.localhost`) | `*.dev.…` → fe-client<br>`*.portal.dev.…` → fe-portal | `*.reservetoday.app` → fe-client<br>`*.portal.reservetoday.app` → fe-portal |

### Local development

`*.localhost` resolves to loopback in Chrome, Edge and Firefox with **no hosts-file entry and
no admin rights**, including multi-level names. Safari does not — Safari users add hosts
entries (`127.0.0.1 yogasadhana.localhost`) or use `lvh.me`.

Keep the `portal.` segment locally even though ports 3000/3001 already separate the apps: it
makes fe-portal exercise the same two-label strip it runs in production.

Creating a tenant locally is just the row insert (super portal or seed script) — the new
subdomain works immediately. **Cache caveat:** the slug→tenant lookup runs on every request
and should be cached; give it a short TTL and bust on write, or new tenants appear to not
exist for a minute.

### Staging

The `dev` label is effectively forced. The alternative `dev-{tenant}.reservetoday.app` sits at
the *same* level as production tenants and would be swallowed by `*.reservetoday.app`, which
binds to exactly one Vercel project. One level down gives staging its own namespace.

⚠️ **Naming inconsistency to fix:** the backend staging host is currently
`api.staging.reservetoday.app` while the frontends use `dev`. Align on `dev` — move the BE to
`api.dev.reservetoday.app`, keeping the old name as an alias through the transition.

### Two rules people get wrong

- **The API hostname never contains the tenant.** One backend serves everyone at
  `api.reservetoday.app`, so its own Host header carries no tenant information. The frontend
  must send it: `proxy.ts` resolves the slug and forwards `X-Tenant-Slug` on every API call;
  the BE validates it against the Clerk org claim on authenticated routes and against `Origin`
  on public ones. **Never trust an inbound `X-Tenant-*` header** — strip and overwrite it on
  every path through the proxy, per Vercel's explicit warning.
- **Reserve slugs from day one.** Block `admin`, `api`, `portal`, `www`, `dev`, `staging`,
  `app`, `mail`, `clerk`, `assets` at tenant creation. A tenant registering the slug `admin`
  takes over the super portal's hostname.

### Run ≥2 tenants in every environment

A single-tenant environment **cannot** reveal a cross-tenant leak — every missing
`WHERE tenant_id = ?` looks correct when there is only one tenant's data to return. Seed
`yogasadhana` plus a throwaway `acme` in local and staging from the start of Phase 1 so
isolation bugs surface the day they are written, not the day tenant #2 signs up.

## Pre-implementation checks (do these first, human tasks)

- [x] ~~**Where is `reservetoday.app` registered?**~~ **GoDaddy.com, LLC** (RDAP, 2026-08-31), which
      allows nameserver edits in-account — no transfer, no 60-day lock. **The NS move is DONE (2026-08-31).**
      Nameservers are now `ns1/ns2.vercel-dns.com`; Option A is in force and Option B is dead.
      This happened ahead of its ticket (#70), so treat #70's first acceptance criterion as
      already met. ⚠️ It was done **without** the record inventory below — see the incident note.
- [x] ~~Is `api.reservetoday.app` orange- or grey-clouded?~~ **Answered: grey, deliberately.**
      Traefik's `le-tls` resolver is TLS-ALPN-01, which proves control of :443 and cannot
      complete through a proxied host, so both `api*` records are DNS-only by design.
- [x] ~~What cert does the VPS serve today?~~ **Answered: a real Let's Encrypt cert**, issued by
      Traefik. No Origin Certificate, no certbot work. Because the resolver needs only an A
      record, the NS move does not threaten it.
- [ ] Note the standing constraint: the VPS can **never** issue a wildcard cert for this zone —
      `le-tls` can't do wildcards, and the DNS-01 resolver's Cloudflare token is scoped to the
      Teeko account while `reservetoday.app` is in the Blueprint account (Traefik reads that
      token process-wide). A concrete reason the frontends stay on Vercel.
- [x] ~~Inventory ALL existing DNS records in the Cloudflare zone~~ — **skipped, and it caused a
      production outage.** Recorded here because the next zone migration must not repeat it.
      Reconciled retroactively on 2026-08-31 from a Cloudflare zone export, since the deactivated
      zone retains its records: 18 existed, 2 were recreated by hand during the outage, 4 are
      covered by the `*` ALIAS, and **12 were lost** — 10 Clerk custom-domain CNAMEs, the `cdn`
      R2 host, and `_dmarc`. Full reconciliation and the constraints it produced are in
      `docs/adr/0001-reservetoday-app-on-vercel-nameservers.md`.

  > **Incident, 2026-08-31 — `api.reservetoday.app` down after the nameserver move.**
  > Moving NS to Vercel carries over nothing. The new Vercel zone was created with only three
  > CAA records and two auto-generated ALIASes (apex and `*`). The `api` A record did not exist,
  > so the **`*` ALIAS swallowed `api.reservetoday.app` and pointed it at Vercel**, which
  > returned `DEPLOYMENT_NOT_FOUND` — taking the backend offline for both frontends. Recovery
  > was two records, since a specific A record beats the wildcard:
  >
  > ```
  > vercel dns add reservetoday.app api         A 187.127.207.82 --scope blueprintdigitalmy
  > vercel dns add reservetoday.app api.staging A 187.127.207.82 --scope blueprintdigitalmy
  > ```
  >
  > The VPS IP is recorded nowhere in this repo — deploys reach bpvps2 over Tailscale — and had
  > to be recovered from `Blueprint-Agency/teeko-infrastructure`
  > (`vps/bpvps2/stacks/stalwart/README.md`). **bpvps2 = `187.127.207.82`.** Note it here so the
  > next recovery is not an archaeology exercise. TLS was never at risk: Traefik's TLS-ALPN-01
  > cert needs only the A record, and `letsencrypt.org` is in the zone's CAA set — both frontends
  > and both API hosts verified clean afterwards.
  >
  > **All MX and TXT records were also lost.** Confirmed not a problem for this zone — mail for
  > `reservetoday.app` is not hosted here (unlike `blueprintdigital.my`, whose mail is on the same
  > box under Stalwart). The zone in fact carried **no MX at all** and exactly one TXT, `_dmarc`
  > (`p=quarantine`, `rua` to a GoDaddy address). No Stripe or Google Search Console verification
  > record ever existed here.
  >
  > The general rule, which the sibling zone learned the hard way too (bpvps2 Stalwart README:
  > `blueprintdigital.my` had no MX for three weeks): **on any zone migration, inventory first,
  > recreate second, switch NS last.**
- [ ] Verify remaining UNVERIFIED items in `research-multi-tenancy.md` (Clerk Platform API
      surface, current Clerk pricing). *Vercel wildcard plan-gating is now resolved — all plans.*

### Spike 1 — wildcard precedence across two projects — ✅ **RESOLVED 2026-08-31: precedence holds**

**The URL scheme is safe. Build on it.** The more-specific wildcard on a *different* project
wins, so `{tenant}.portal.reservetoday.app` reaches fe-portal even though
`*.reservetoday.app` on fe-client also matches it at the DNS layer. The fallback (separate
root domain for the portal) is **not needed**.

Run live on `reservetoday.app` itself — which was already on Vercel nameservers by then — using
two throwaway projects (`spike-client`, `spike-portal`) and an unused `spike.` label, so no
production hostname was touched. Both wildcards attached to different projects without conflict;
Vercel raised no ownership error.

| Hostname | HTTP | Served by |
|---|---|---|
| `x.spike.reservetoday.app` | 200 | `spike-client` |
| `acme.spike.reservetoday.app` | 200 | `spike-client` |
| `deep.nested.spike.reservetoday.app` | TLS handshake failure | — |
| `x.portal.spike.reservetoday.app` | 200 | **`spike-portal`** |
| `acme.portal.spike.reservetoday.app` | 200 | **`spike-portal`** |
| `admin.portal.spike.reservetoday.app` | 200 | **`spike-portal`** |
| `a.b.portal.spike.reservetoday.app` | TLS handshake failure | — |

**Why it holds — the mechanism matters more than the verdict.** Correction 2 above was right
that Vercel's *DNS* wildcard is multi-level: both `x.spike` and `x.portal.spike` resolved through
the single apex `*` ALIAS, with no per-wildcard DNS records created. But **TLS wildcards are
single-label** (RFC 6125), and Vercel issues one certificate per attached wildcard —
`*.spike.reservetoday.app` and `*.portal.spike.reservetoday.app` were issued separately. A
certificate for `*.spike` cannot cover `x.portal.spike`, so fe-client is structurally incapable
of serving a two-label host. `deep.nested.spike` failing the handshake is the proof: multi-level
DNS resolution does **not** imply multi-level serving. The certificate boundary, not a routing
rule, is what makes the scheme work.

**Operational note for Phase 5:** certificate issuance is not instant and not uniform. `*.spike`
was serving in ~60s; `*.portal.spike` took ~3 minutes, during which it returned a TLS handshake
failure rather than an HTTP error. Because `.app` is HSTS-preloaded there is no plaintext
fallback to mask this. **Do not conclude a wildcard has failed until several minutes have
passed** — an early read of that window looks exactly like "precedence does not hold".

Teardown: delete `spike-client` and `spike-portal` and their two wildcard domains once Phase 5
is underway; they cost nothing but are live hostnames on a production zone.

### Spike 2 — staging wildcard on a non-production environment — ✅ **RESOLVED 2026-08-31**

Custom environments (Pro+) accept custom domains, but **wildcard support on a non-production
environment is undocumented**, and multi-tenant *preview* URLs are Enterprise-only.

- [x] ~~Confirm `*.dev.reservetoday.app` can be attached to a `staging` custom environment.~~
      **Superseded** — no custom environment is being created; Preview is treated as staging.
      A wildcard on a non-production deployment is confirmed to work (below).
- [x] ~~If not: create two dedicated staging Vercel projects with production branch = `staging`.~~
      **Not needed on wildcard grounds.** Still the fallback if a wildcard turns out not to be
      *branch-assignable* — see the open item below.

✅ **RESOLVED 2026-08-31 — a wildcard IS attachable to a non-production deployment, but
Deployment Protection makes it unusable until switched off.**

**Decision taken:** do **not** create a custom `staging` environment. Vercel's built-in
**Preview** environment is treated as staging. That is also what the projects already do.

**What was proven.** `*.dev.spike.reservetoday.app` was aliased onto a non-production
(preview) deployment of `spike-client`. Vercel accepted it and issued a certificate covering
both `*.dev.spike.reservetoday.app` and `dev.spike.reservetoday.app` in ~22s. So the
undocumented question — *can a wildcard live outside Production?* — is answered **yes**, and the
"two dedicated staging projects" fallback is **not required** on wildcard grounds.

⚠️ **The blocker is Deployment Protection, not wildcards.** Every tenant hostname on the preview
alias returns `302 → https://vercel.com/sso-api?url=…` with a `_vercel_sso_nonce` cookie. Vercel
Authentication is on by default for non-production deployments, so `{tenant}.dev.reservetoday.app`
is unreachable to anyone outside the Vercel team — including the studio staff and testers staging
exists for. **Phase 5 must disable Deployment Protection on the staging target (or configure a
bypass), and that decision makes staging publicly reachable — it needs to be a conscious one.**

⚠️ **Still unproven: branch-tracked wildcards.** The test used `vercel alias set`, which pins a
domain to *one immutable deployment* — it does not follow new pushes. A staging URL must instead
be **branch-assigned** (domain → `staging` branch) so it auto-updates. `vercel domains add` has no
target/branch flag and `vercel target` is list-only, so branch assignment is **dashboard-only and
was not tested for wildcards**. Confirm this in the dashboard during Phase 5 before relying on it;
if a wildcard cannot be branch-assigned, the two-dedicated-staging-projects fallback returns.

**Supporting findings:**

- **No custom environments exist anywhere in the team.** `vercel target ls` on both
  `booking-system` and the throwaway `spike-client` returns only the stock trio —
  Production / Preview / Development. This spike therefore tests a mechanism the project does
  not currently use at all.
- **Today's staging is branch-assigned domains, not a custom environment.** Certificates exist
  for `staging.reservetoday.app`, `staging.yogasadhana.reservetoday.app`,
  `stagingportal.reservetoday.app` and `staging-portal.yogasadhana.reservetoday.app` — i.e.
  ordinary domains pointed at the `staging` branch on the existing projects. Worth weighing:
  the fallback (two dedicated staging projects) is closer to what is already in place than the
  custom-environment shape is.
- **The CLI cannot create custom environments** — `vercel target` exposes `list` only, so the
  remaining step is dashboard-only and cannot be automated or scripted in CI.

## Implementation checklist (in order)

### Phase 1 — Data model (the big one)
- [ ] `tenants` table (slug, name, timezone, Clerk org IDs, status) + `tenant_settings`
      (branding, copy, mail-from, theme, waiver text).
- [ ] Reserved-slug list enforced at tenant creation (`admin`, `api`, `portal`, `www`, `dev`,
      `staging`, `app`, `mail`, `clerk`, `assets`).
- [ ] Add `tenant_id` across **all 53 tables** in `be/src/db/schema/`'s 12 files —
      including child tables that could inherit it via FK, so RLS has a column to key on.
- [ ] **Three-step migration, not one:** add nullable column → backfill everything to
      tenant #1 (Yoga Sadhana) → add `NOT NULL` + composite indexes. One reviewed migration
      touching 53 live tables is the riskiest single moment in this project.
- [ ] Scope every service query by `tenant_id`; add Postgres RLS as the fail-closed backstop.
      **Set tenant context transaction-scoped:** `set_config('app.current_tenant_id', $1, true)`
      — session scope leaks across pooled connections.
- [ ] ⚠️ **Connect as a dedicated non-superuser role that does not own the tables.** Without this
      RLS is inert (owners bypass policies; superusers bypass even `FORCE`) and every test still
      passes. Migrations keep running as the owner. New env var + GitHub Environment secret.
- [ ] **Five singleton constraints block the contract step** (found while implementing the
      expand step, #59). `waiver`, `marketing_content`, `global_policy` and `pt_booking_config`
      each carry a `CHECK (id = '<fixed uuid>')` singleton constraint, and `feature_flags` has
      `key` as its sole primary key. All five now have a `tenant_id` column, but no second
      tenant can ever own a row in them — so today `acme` would render Yoga Sadhana's waiver,
      marketing content and policy. Each needs its primary key / check widened to include
      `tenant_id` before per-tenant settings mean anything.
- [ ] Move seeds (`locations.ts`, `waiver.ts`, `email-copy.ts`, `corporate-packages.ts`)
      to per-tenant provisioning data. Until then `db:seed` finishes with
      `claim-tenant-one.ts`, which claims anything a seeder wrote for tenant #1 — every
      seeder writes an explicit column list that knows nothing about tenancy, and `db:seed`
      runs after `db:migrate` on every deploy.
- [ ] Seed a second synthetic tenant (`acme`) in local + staging — isolation bugs are
      invisible with one tenant.

### Phase 2 — Tenant resolution
- [ ] `proxy.ts` in fe-client + fe-portal (**not** `middleware.ts` — both apps are on Next 16,
      which renamed the convention; runs on the Node.js runtime, required for the DB lookup).
      Read Host → strip `NEXT_PUBLIC_ROOT_DOMAIN` suffix → slug → resolve tenant → rewrite;
      unknown slug → 404. Delete inbound `x-tenant-*` headers on **every** path, including
      paths that skip resolution.
- [ ] FE forwards `X-Tenant-Slug` on every BE call; BE never infers tenant from its own Host.
- [x] BE middleware: resolve tenant from `X-Tenant-Slug`, validated against the Clerk org
      claim (authenticated routes) or `Origin` (public routes) → attach to context.
      **Done (#65)** — see `docs/md/spec-tenant-resolution.md`.
- [x] CORS becomes pattern-based (`*.reservetoday.app`, `*.dev.reservetoday.app`) instead of
      single-valued `PORTAL_ORIGIN`/`CLIENT_ORIGIN`; same for `CLERK_STAFF_AUTHORIZED_PARTIES`.
      **Done (#65)** — new `TENANT_ORIGIN_PATTERNS`, matched by `be/src/lib/origin.ts`. Clerk's
      own `authorizedParties` is exact-match and cannot express a per-tenant subdomain, so the
      `azp` claim is checked against the same allowlist instead.
- [x] Map Clerk Organization ↔ `tenant_id`; enforce org membership on portal routes.
      **Done (#65)**, with a one-way rollout seam: enforcement turns on for a tenant the moment
      its org id is written to its row. Provisioning the organizations is still #58.
- [x] **Webhook tenant resolution decided and recorded** (verification-pass item 3). The Clerk
      Organization is the authority; `user.*` events are identity only; an event that names no
      studio is a logged no-op, never a guess. `docs/md/spec-tenant-resolution.md`.
- [x] **One person, two studios.** `clients` / `staff_users` uniques on `clerk_user_id` and
      `email` widened to `(tenant_id, …)` in migration 0035 — the platform-wide version was the
      same sentence as "nobody may belong to two studios".
- [ ] Cache the slug→tenant lookup (short TTL, bust on write) — it runs on every request.

### Phase 3 — De-hardcode branding + tenant-aware jobs
- [ ] Replace "Yoga Sadhana" strings with `tenant_settings` lookups. Actual scope measured:
      **8 BE files + 16 FE files** (layouts, nav, auth pages, email templates, waiver).
- [ ] `be/src/lib/mailer.ts` `MAIL_FROM` → per-tenant from-address.
- [ ] R2 object paths + webhooks scoped by tenant.
- [ ] **Background jobs (not in the original plan).** All 6 `node-cron` jobs in
      `be/src/jobs/index.ts` are tenant-blind global sweeps *and* hardcoded to SGT. Make each
      sweep `tenant_id`-aware and drive daily schedules off `tenants.timezone` — "daily 01:00"
      is wrong the moment tenant #2 isn't in Singapore.
- [ ] Fence impersonation and `audit_log` by tenant — a superadmin bug here is a
      cross-tenant data leak.

### Phase 4 — Payments
- [ ] Stripe Connect onboarding per tenant; checkout/webhooks routed by connected account.

> **Ordering note:** Phase 4 is the deepest unknown and blocks nothing else — v1 can ship with
> all tenants on the platform Stripe account. Consider running it last, after Phase 6, and
> promoting the DNS cutover ahead of it since that's what gates "URLs work instantly".

### Phase 5 — Infra cutover (DNS)
- [ ] Add `reservetoday.app` in Vercel → get Vercel nameservers.
- [ ] Recreate all records in Vercel DNS (incl. `api` A record → VPS IP).
- [ ] Switch NS at the registrar; verify propagation + `api` TLS still valid.
- [ ] Attach `*.reservetoday.app` to fe-client, `*.portal.reservetoday.app` to fe-portal;
      add `*.dev.…` / `*.portal.dev.…` per Spike 2's outcome.
- [ ] **Portal URL flip:** `portal.yogasadhana.reservetoday.app` →
      `yogasadhana.portal.reservetoday.app`. 301 the old host, update `PORTAL_ORIGIN`, Clerk
      allowed origins/redirect URLs, and staff comms. fe-client's URL is unchanged.
- [ ] Rename BE staging host `api.staging.…` → `api.dev.…` (keep old as alias).
- [ ] Public Suffix List: not needed — tenants can't publish content or run code on their
      subdomains. Revisit only if that changes (Vercel recommends PSL submission for cookie
      isolation in that case).

### Phase 6 — Super portal (the easy part, last)
- [ ] Superadmin-gated section in fe-portal: create tenant (DB row + settings +
      Clerk org in both apps + invite first admin), list/suspend tenants, billing overview.
- [ ] Migrate Yoga Sadhana itself to be tenant #1.

## Env-var note

Per repo convention: any BE env var added/renamed in this work must update
`.github/workflows/deploy-be.yml`, `be/.env.example`, and `be/src/env.ts` together;
new `NEXT_PUBLIC_*` vars must also be set in the Vercel dashboard.
