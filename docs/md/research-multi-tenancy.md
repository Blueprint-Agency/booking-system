# Research: Productizing the Booking System into Multi-Tenant SaaS

**Date:** 2026-08-31 · **Researched against primary sources only** (clerk.com/docs, vercel.com/docs, developers.cloudflare.com, letsencrypt.org). Every claim carries its source URL. Anything not confirmed from a primary source is marked **UNVERIFIED**.

**Context:** Current stack is single-tenant: two Next.js frontends on Vercel (`fe-client`, `fe-portal`), Hono backend on a Hostinger VPS, Cloudflare DNS, Clerk with two separate applications (client + portal, each with dev + prod instances = 4 Clerk projects), Postgres + Drizzle. Goal: a super-admin portal that provisions a tenant and dynamically gets `tenant1.example.com` (client) and `tenant1-portal.example.com` (portal).

---

## 1. Clerk multi-tenancy

### 1.1 One Clerk app + Organizations is Clerk's recommended model — with one important caveat

Clerk's "Multi-tenant architecture" doc explicitly endorses the **shared user-pool** model for B2B: one Clerk application, one user pool, each customer represented as an **Organization**, "a single application deployment that serves multiple business customers (multi-tenant)" served "from a single domain (for example: `app.example.com`)". "The Organization's ID should be stored in your database alongside each resource so that it can be used to filter and query the resources."
Source: https://clerk.com/docs/guides/how-clerk-works/multi-tenant-architecture

**The caveat:** the same page says Clerk does **not currently support** what it calls the "Platforms scenario" — giving each customer a **vanity domain** (`customer.example.com`) or custom domain (`customer.com`) with per-customer auth branding/isolation. That capability is positioned as the forthcoming **Clerk for Platforms** offering (see 1.2).
Source: https://clerk.com/docs/guides/how-clerk-works/multi-tenant-architecture

However, this caveat is about *per-tenant auth isolation/branding on vanity domains*, not about whether auth mechanically works on subdomains. Clerk's satellite-domains guide states plainly that **"authentication across subdomains with shared sessions … works by default with Clerk"** when the production instance is rooted at the shared root domain (see 1.3). So one Clerk app rooted at `example.com` will authenticate users on `tenant1.example.com`, `tenant2.example.com`, etc. — but all tenants share one sign-in experience, one user pool, and one Clerk-side branding. Tenant scoping then happens in *your* application via Organizations (active organization, org ID checks), not in Clerk's domain model.
Source: https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains

### 1.2 One Clerk application per tenant: programmatic application creation exists, but it is gated

- Clerk's API reference lists three APIs: Frontend API, Backend API, and a **Platform API** which "is meant to be accessed by backend servers" and is used to "manage resources of a workspace such as your Clerk applications, domains, and application transfers."
  Source: https://clerk.com/docs/reference/api/overview
- The Clerk CLI confirms application creation is a real operation: "`clerk apps list` and `clerk apps create` let you view and create Clerk applications from the terminal", and `clerk api --platform` targets the Platform API (authenticated via `clerk auth login`).
  Source: https://clerk.com/docs/cli
- **Clerk for Platforms** (the productized version of this) advertises "APIs and infrastructure to provision, manage, and customize authentication for your platform's customers" — "Spin up applications for your users with Clerk's APIs. Configure branding, sign-in methods, and SSO providers for each tenant." Access requires contacting sales ("Talk to the team"); pricing is "custom" and not published.
  Source: https://clerk.com/platform
- **UNVERIFIED:** the concrete Platform API endpoint list (e.g. `POST /applications`), auth token type, and plan gating — the reference page `https://clerk.com/docs/reference/platform-api` exists per Clerk's own site search but returned 404 to the fetcher (likely JS-rendered), so the exact endpoint surface could not be read. The *existence* of programmatic application management is verified by the three sources above; the details are not.

**Judgment from primary docs:** app-per-tenant is Clerk's model for *platforms that resell auth* (website builders, etc.) and requires a sales-negotiated arrangement. For a booking SaaS with < 100 studio tenants where every tenant runs the same product, Clerk's own architecture doc points at Organizations, not app-per-tenant.

### 1.3 Subdomains, satellite domains, and multiple Clerk apps on one root domain

- **Same root domain → no satellite config needed.** "This guide addresses authentication across different domains with shared sessions. For example, `example-site.com` and `example-site-admin.com`. **This is not to be confused with authentication across subdomains with shared sessions, which works by default with Clerk.**"
  Source: https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains
- **Satellite domains** are only for *different root domains* sharing one auth state: "Your 'primary' domain is where the authentication state lives, and satellite domains are able to securely read that state from the primary domain." Constraints: sign-in/sign-up must run on the primary domain; production satellites each need a `clerk.` CNAME (or FAPI proxy); "This feature requires a paid plan for production use." Satellite domains are billed at **$10/mo each** (see 1.5). You would only need satellites if tenants later demand fully custom domains (`bookings.tenants-own-domain.com`).
  Sources: https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains · https://clerk.com/pricing
- **Multiple Clerk apps on the same root domain is now supported** (relevant because client + portal are two Clerk apps that would both live under `example.com`): Clerk "rearchitected how it sets and handles cookies to support multiple apps under the same domain", e.g. "dashboard.example.com and admin.example.com without needing a separate domain". The `__session` cookie "is set on your application's domain directly, scoped strictly so it cannot be shared across subdomains". Clerk strongly recommends setting `authorizedParties` when verifying tokens, because "if an app on another subdomain of the same root domain as your Clerk app is compromised, that app could potentially generate valid sessions for your Clerk app" — directly applicable to the Hono backend, which verifies tokens from two Clerk apps across many tenant subdomains.
  Source: https://clerk.com/changelog/2024-09-09-multiple-apps-same-domain
- Clerk explicitly warns **against** the DIY approach of setting `Domain=.example.com` on Clerk cookies to share sessions across subdomains — not a supported pattern. Cookie-scoping background: https://clerk.com/docs/guides/how-clerk-works/cookies

**Implication for the target URL scheme:** with the portal Clerk app's production instance rooted at `example.com`, `tenant1-portal.example.com` and `tenant2-portal.example.com` are all first-level subdomains of the same root — one portal Clerk app covers all of them by default. Same for the client app. The existing two-app split (client vs portal) can be kept as-is.

### 1.4 Dev/prod instances — the current 4-project setup is the documented norm

Each Clerk **application** ships with two **instances**: Development and Production. "A `Development` instance is Clerk's default instance type" — relaxed security, 100-user cap, dev banners, querystring-token session mechanics; "A `Production` instance is the more robust option … meant to support high volumes of traffic", requires a production domain and your own SSO credentials, and uses HttpOnly cookies.
Source: https://clerk.com/docs/guides/development/managing-environments

So "4 Clerk projects" is really **2 applications × 2 instances**, which is exactly Clerk's intended shape. For a *staging* environment, Clerk's guidance is a **separate Clerk application** (deployed with its production-instance keys): "Creating a separate Clerk application will prevent you from using live production environment data in your staging environment," with the warning that config "will not be automatically mirrored" between apps.
Source: https://clerk.com/docs/guides/development/managing-environments

**Multi-tenant impact:** the instance count does not grow with tenants. It stays 2 apps × 2 instances no matter how many tenants exist (unless you go app-per-tenant, which multiplies it).

### 1.5 Organizations features relevant here, and pricing

Feature highlights (all from Clerk docs):

- **Roles/permissions defined once, applied to every Organization**: "define Roles and Permissions once at the application level, and they apply across all Organizations." Default `admin`/`member` roles, custom roles supported. The **Active Organization** "determines which Organization-specific data the user can access and which Role and related Permissions they have."
  Source: https://clerk.com/docs/guides/organizations/overview
- **Forcing membership:** org settings offer "Membership required (default): Every user is required to belong to an Organization" vs "Membership optional". You can also "restrict this [org creation] if you prefer to manually provision Organizations" — exactly the super-admin-provisions-tenants model. Membership limits: default 5 members/org, adjustable to 20, unlimited with the B2B add-on.
  Source: https://clerk.com/docs/guides/organizations/configure
- **Slugs:** human-readable URL identifiers (e.g. `acme-corp`); "disabled by default for applications created after October 7, 2025" but can be enabled — useful for mapping `tenant1` in the hostname to the Clerk org.
  Sources: https://clerk.com/docs/guides/organizations/configure · https://clerk.com/docs/guides/organizations/org-slugs-in-urls
- **Verified domains:** auto-invite/auto-suggest membership by email domain — company-wide rollouts.
  Source: https://clerk.com/docs/guides/organizations/overview
- **Per-org branding:** Clerk's appearance/sign-in customization is application-level, not organization-level; the multi-tenant architecture doc counts per-customer branding under the unsupported "Platforms scenario" (1.1). Orgs carry a logo/name used in Clerk's own UI components, but a fully tenant-branded sign-in page per subdomain is not a documented capability of a single app. **Partially UNVERIFIED** (documented as absent rather than documented as present — inferred from https://clerk.com/docs/guides/how-clerk-works/multi-tenant-architecture).

**Pricing** (as read from https://clerk.com/pricing on 2026-08-31 — Clerk moved to a "retained user" model; re-check before budgeting):

- Free plan: "50,000 MRU (monthly retained user) limit per app"; Pro: "$25/mo ($20/mo billed annually)", then "$0.02/mo each" per user beyond the included amount.
- Organizations: "100 MROs (monthly retained organizations) included per app"; the enhanced **B2B add-on** (unlimited org members, advanced RBAC) is "$100/mo ($85/mo billed annually)".
- Satellite domains: "$10/mo each". Enterprise SSO connections: "$75/mo each" for the first, scaling down.
- "Unlimited applications" per workspace — but each app bills its own MAU/MRU and its own add-ons, so **app-per-tenant multiplies every per-app add-on** (e.g. a $100/mo B2B add-on × N tenants), while one shared app pools all tenants into one MRU/MRO count with < 100 studios comfortably inside the included 100 MROs.
  Source: https://clerk.com/pricing

---

## 2. Dynamic tenant subdomains on Vercel

### 2.1 Wildcard domains: supported, but the domain **must** move to Vercel nameservers

- "If using your custom domain as a wildcard domain, you **must use the nameservers method for verification**." Adding `*.example.com` auto-enables Vercel nameservers for the domain. Ordinary subdomains use per-name CNAMEs; apex uses an A record — but wildcards specifically require `ns1.vercel-dns.com` / `ns2.vercel-dns.com` as the authoritative NS.
  Sources: https://vercel.com/docs/domains/working-with-domains/add-a-domain · https://vercel.com/docs/platforms/multi-tenant-platforms/concepts ("**Requirements**: Must use Vercel's nameservers")
- SSL: "Wildcard domains: Single wildcard certificate covers all subdomains … Automatic renewal … No configuration required" (Let's Encrypt under the hood).
  Source: https://vercel.com/docs/platforms/multi-tenant-platforms/concepts
- Plan gating: current docs place **no plan restriction on wildcard domains themselves**; the stated limits are domain counts — "Hobby: 50 domains [per project]; Pro: Unlimited (soft limit: 100,000)". Multi-tenant **preview URLs** (`tenant1---project-git-branch.vercel.app`) are Enterprise-only. "Domains: No additional cost for domains (within plan limits)."
  Source: https://vercel.com/docs/platforms/multi-tenant-platforms/reference
- **UNVERIFIED:** whether older Pro-only wildcard gating still exists anywhere in billing — the current docs simply don't mention a plan requirement.

### 2.2 The multi-tenant pattern: one deployment, zero per-tenant infra — confirmed

Vercel's "Vercel for Platforms" docs describe exactly the target architecture and confirm **no per-tenant deployment is needed**:

- "**Multi-tenant**: One codebase, one deployment serves every tenant" — recommended when "Content and branding differ, but functionality is the same (… SaaS dashboards)". The alternative ("Multi-project": one project/deployment per tenant) is for tenants needing *custom code* — not this case.
  Source: https://vercel.com/docs/platforms
- "A typical setup gives you a root domain for your platform (`acme.com`), subdomains for tenants (`tenant1.acme.com`), and fully custom domains for customers who want them."
  Source: https://vercel.com/docs/platforms
- Mechanics: middleware/proxy reads the `Host` header, resolves the tenant, and forwards `x-tenant-id` on the request headers ("Use `NextResponse.next({ request: { headers } })` … Delete or overwrite inbound `x-tenant-*` headers on every path through the proxy so clients can't supply tenant context themselves."). "Any subdomain (`tenant1.yourapp.com`, `tenant2.yourapp.com`) automatically routes to your app."
  Source: https://vercel.com/docs/platforms/multi-tenant-platforms/concepts
- Reference implementation: the **Platforms Starter Kit** template — https://vercel.com/templates/next.js/platforms-starter-kit (linked from https://vercel.com/docs/platforms).

For this codebase that means **two** multi-tenant Vercel projects: `fe-client` bound to `*.example.com` and `fe-portal` bound to… note that `tenant1-portal.example.com` and `tenant1.example.com` are both first-level names under the same wildcard, so a single `*.example.com` can only point at **one** Vercel project. Two clean options, both wildcard-compatible: (a) put the portal on its own level — `tenant1.portal.example.com` via `*.portal.example.com` on the fe-portal project (a more-specific wildcard record coexists with `*.example.com`), or (b) keep `tenant1-portal.example.com` and have the fe-client project's proxy rewrite `-portal` hosts… which breaks the decoupling convention. Option (a) is the shape Vercel's model supports directly. (This routing consequence is analysis, not a doc quote.)

### 2.3 Programmatic domain management (tenant custom domains later)

The Vercel REST API / `@vercel/sdk` covers the whole lifecycle: add (`vercel.domains.createOrTransferDomain`), status (`getDomain`), verify config (`getDomainConfig`), remove (`deleteDomain`), list (`getDomains`); tenant-owned custom domains are added to the project via SDK, the tenant sets a CNAME/TXT, and "Vercel issues SSL certificate automatically."
Sources: https://vercel.com/docs/platforms/multi-tenant-platforms/reference · https://vercel.com/docs/platforms/multi-tenant-platforms/concepts · https://vercel.com/docs/rest-api/domains/add-an-existing-domain-to-the-vercel-platform

### 2.4 Wildcard + Cloudflare: pick one authority

- Because Vercel wildcards require Vercel to be the **authoritative nameserver**, "wildcard on Vercel + zone stays on Cloudflare DNS" is not a supported combination. If nameservers move to Vercel, "you will need to add any DNS records to Vercel that you wish to keep from your previous DNS provider" (MX, the VPS A records, etc.).
  Source: https://vercel.com/docs/domains/working-with-domains/add-a-domain
- Proxying Vercel through Cloudflare (orange cloud) is explicitly discouraged: "We do not recommend using a reverse proxy in front of Vercel" — it limits Vercel's traffic visibility/security features, adds latency, complicates caching, and degrades Bot Protection. If proxying is unavoidable, SSL mode Full is required, and the wildcard-SAN Origin CA workaround is described for Enterprise. For plain Cloudflare **DNS-only (grey cloud)** records pointing at Vercel, traffic goes directly to Vercel and works normally.
  Source: https://vercel.com/kb/guide/cloudflare-with-vercel
- **Alternative that keeps Cloudflare as DNS authority:** skip the wildcard and have the tenant-provisioning service add each tenant hostname explicitly — 2 Vercel API calls (add `tenant1.example.com` to fe-client project, `tenant1.portal.example.com` to fe-portal project) + 2 Cloudflare DNS API calls creating DNS-only CNAMEs to each project's `*.vercel-dns-0xx.com` target. Per-name CNAME verification is the documented non-wildcard path (https://vercel.com/docs/domains/working-with-domains/add-a-domain); Cloudflare record creation via API: https://developers.cloudflare.com/api/resources/dns/subresources/records/. Slightly more provisioning code, no nameserver migration, still zero per-tenant deployments.

---

## 3. Cloudflare wildcard DNS + SSL

- **Wildcard records, all plans, proxied allowed:** "Customers on all plans can create and proxy wildcard DNS records." "Wildcard DNS records can be either proxied or DNS-only." A wildcard "is already multi-level by default, meaning it would cover `abc.example.com` as well as `123.abc.example.com`" where no more-specific record exists. (This confirms the post-2021 state: wildcard proxying is no longer Enterprise-only.)
  Source: https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/
- **Universal SSL covers only one level:** on full-setup zones it covers "your root domain (for example, `example.com`) and first-level subdomains (for example, `www.example.com`)" — i.e. `tenant1.example.com` is covered, `tenant1.portal.example.com` is **not**; "full setup zones that need coverage beyond first-level subdomains" need **Total TLS or advanced certificates**. Universal SSL is free on every plan. On CNAME/partial setups, wildcard certs additionally require DCV tokens.
  Sources: https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/ · https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/
- **Cloudflare for SaaS is for customer-owned hostnames, not your own subdomains:** it exists to "Extend the security and performance benefits of Cloudflare's network to your customers via their own custom or vanity domains" (e.g. `app.customer.com` riding on your zone). Your own `*.example.com` tenant subdomains never need it. It is bundled on non-Enterprise plans with **100 custom hostnames included free**, "$0.10" per additional hostname per month, up to 50,000; **wildcard custom hostnames are Enterprise-only**. Relevant only if/when tenants bring their own domains *and* the fronting stays on Cloudflare rather than Vercel (Vercel's domains API covers the same need if frontends stay on Vercel).
  Sources: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/ · https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/
- **If frontends stay on Vercel with Cloudflare DNS:** grey-cloud (DNS-only) the Vercel-pointing records — proxying is the configuration Vercel documents against (see 2.4). Keep orange-cloud only for VPS-origin records (`api.example.com`) where Cloudflare's proxy/WAF genuinely fronts your own origin.
  Source: https://vercel.com/kb/guide/cloudflare-with-vercel

---

## 4. Architecture judgment call — evidence

**Shared deployment + hostname tenant resolution + `tenant_id` scoping is the documented default for this product shape.**

- Vercel: multi-tenant ("One codebase, one deployment serves every tenant", "Lower" complexity) is the recommended architecture when "functionality is the same"; multi-project (instance-per-tenant) is reserved for tenants needing "custom code or isolated infrastructure". Data isolation guidance is exactly row-scoping: "**Database-level**: Use tenant ID in all queries" (`where: { tenantId: tenant.id }`), with the proxy stamping a trusted `x-tenant-id` header.
  Sources: https://vercel.com/docs/platforms · https://vercel.com/docs/platforms/multi-tenant-platforms/concepts
- Clerk: the shared user-pool + Organizations model, with "The Organization's ID … stored in your database alongside each resource so that it can be used to filter and query the resources", i.e. the same row-scoping pattern on the auth side.
  Source: https://clerk.com/docs/guides/how-clerk-works/multi-tenant-architecture
- Named precedents in Vercel's own docs running thousands of tenants on one project: Hashnode, Dub, Super ("thousands of domains on one project"), Cal.com, Instatus.
  Source: https://vercel.com/docs/platforms
- Postgres hardening option: `tenant_id` column scoping can be enforced at the DB layer with **Row-Level Security** policies (`CREATE POLICY` + `current_setting`-based tenant checks) so a missed `WHERE` clause fails closed. Postgres primary docs: https://www.postgresql.org/docs/current/ddl-rowsecurity.html. Drizzle exposes RLS policy definitions natively: https://orm.drizzle.team/docs/rls. (Both are the owning projects' own docs; the *choice* to add RLS is a recommendation, not a doc mandate.)

**"Super-admin provisions a tenant = a DB row + routing", not new infra — supported by the primitives:**

- Wildcard routing means a new subdomain needs no Vercel action at all ("Any subdomain … automatically routes to your app" — https://vercel.com/docs/platforms/multi-tenant-platforms/concepts); with the non-wildcard Cloudflare-kept variant it's two idempotent API calls (2.4).
- Clerk: "You can restrict this [org creation] if you prefer to manually provision Organizations" (https://clerk.com/docs/guides/organizations/configure) — the super-admin portal calls the Backend API to create the Organization, inserts the `tenants` row (slug, org IDs for both Clerk apps, branding), invites the studio owner. No new Clerk apps, no new deployments, no new DNS zones.
- Vercel ships prebuilt "Platform elements" (blocks/actions for add-custom-domain flows) precisely for building such an admin surface: https://vercel.com/docs/platforms/platform-elements/blocks/custom-domain

**Would moving the frontends to the VPS gain anything?** Mostly no, per the platform docs:

- What Vercel provides out of the box for this pattern: wildcard routing + "Vercel issues SSL certificates for each subdomain on the fly", "Automatic renewal", programmatic domain API, CDN/Anycast routing (https://vercel.com/docs/platforms · https://vercel.com/docs/platforms/multi-tenant-platforms/concepts). Self-hosting reproduces this with a reverse proxy + wildcard cert, where Let's Encrypt wildcard issuance **requires the DNS-01 challenge** ("You can use this challenge to issue certificates containing wildcard domain names"; HTTP-01 "cannot be used to issue wildcard certificates") — i.e. the proxy needs a Cloudflare API token for automated renewal. Source: https://letsencrypt.org/docs/challenge-types/
- The one genuine gain of VPS-hosted frontends: Cloudflare's zone stays authoritative (no Vercel-NS migration) and everything (orange-clouded wildcard on all plans, one-level Universal SSL at the edge) sits in one vendor. The costs: you take on Next.js serving/scaling/CI, lose Vercel's per-subdomain cert automation and preview deployments, and the wildcard-NS constraint disappears anyway if you use the per-tenant-CNAME provisioning variant (2.4). Net: not worth it for < 100 tenants. (Judgment; the individual facts above are cited.)

---

## Recommendation summary

1. **Keep one shared deployment per app; tenant = data, not infra.** One `fe-client` project, one `fe-portal` project, one Hono backend, one Postgres. Tenant resolution by `Host` header in Next.js proxy/middleware (stamped `x-tenant-id`, inbound header stripped) and in a Hono middleware; every table gets `tenant_id`, ideally enforced with Postgres RLS via Drizzle. This is the architecture Vercel documents as the low-complexity default for same-functionality tenants and matches Clerk's shared-pool guidance. (Sources in §4.)
2. **Clerk: keep the existing 2 applications (client, portal) × dev+prod instances — do not create Clerk apps per tenant.** Model each studio as a Clerk **Organization** in both apps (store both org IDs on the tenant row); disable self-serve org creation so the super-admin portal provisions orgs via the Backend API; enable slugs; set `authorizedParties` in the Hono token verification. App-per-tenant via the Platform API / Clerk for Platforms is real but sales-gated, custom-priced, and multiplies per-app costs — reserve it for a future where tenants need white-label auth on their own domains. (Sources in §1.)
3. **URL scheme: prefer `tenant1.example.com` + `tenant1.portal.example.com`** over `tenant1-portal.example.com`, because both frontends are separate Vercel projects and each wildcard level can bind to exactly one project (`*.example.com` → fe-client, `*.portal.example.com` → fe-portal). Both remain under the same root domain, so both Clerk apps' subdomain auth still "works by default". (Sources in §1.3, §2.2.)
4. **DNS: choose one of two clean setups.** (a) Move `example.com` nameservers to Vercel, recreate MX/API records there, and get true zero-touch wildcard provisioning; or (b) keep Cloudflare authoritative, skip wildcards, and have tenant provisioning add two per-tenant CNAMEs (Cloudflare API, DNS-only/grey-cloud) plus two Vercel domain-API calls. Never orange-cloud Vercel-bound records. Cloudflare for SaaS is unnecessary for your own subdomains; revisit it (or Vercel's domain API, which suffices) only for tenant-owned custom domains. (Sources in §2.4, §3.)
5. **Tenant provisioning flow (super-admin portal):** insert `tenants` row (slug, name, branding, plan) → create Clerk Organization in client app + portal app → (variant b only) 2 Cloudflare CNAMEs + 2 Vercel domain adds → invite studio owner to the portal org. Rollback is deleting the same. No deployments, no new Clerk apps, no new databases.
6. **Do not move the frontends to the VPS.** The only gain is keeping Cloudflare's nameservers, which option 4(b) already achieves; the losses are Vercel's automatic per-subdomain SSL, CDN, previews, and the platform-elements/domain API tooling, in exchange for operating wildcard DNS-01 cert renewal and Next.js serving yourself. (Sources in §4.)
