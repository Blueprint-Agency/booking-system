# Backend Tenant Resolution

> Recorded 2026-08-31 for #65 (parent spec #55). Companion: `multi-tenancy-plan.md` Phase 2.
> Status: **implemented.**

How one backend, on one hostname, decides which studio a request or a webhook is
about — and what it refuses when the answer does not add up.

## The shape of the problem

`api.reservetoday.app` serves every tenant. Its own `Host` header therefore
carries no tenant information, so unlike the two frontends the backend cannot
read the tenant off the URL it was reached at. Something on the request has to
say, and everything that can say is, to some degree, attacker-controlled.

The rule the rest of this document follows: **`X-Tenant-Slug` is a claim, not a
fact.** It is set by our own proxies, and a proxy is one forged header away from
being impersonated. Every request is therefore resolved from the header and then
corroborated by whatever second, independent statement it can carry.

## Requests

`middleware/tenant.ts` runs on every `/api/v1/*` path except the four that
resolve their own tenant or must not touch the database (`healthz`, the slug
lookup, and the two webhooks).

### 1. Resolve

| Present | Tenant |
|---|---|
| `X-Tenant-Slug` | that slug |
| `Origin` naming a tenant, no header | the origin's tenant |
| both, agreeing | that tenant |
| both, disagreeing | **403 `tenant_mismatch`** |
| neither | tenant #1 |

The last row is the compatibility seam: every client that predates tenancy sends
no header, and must keep working.

Resolution also opens the database's tenant context — one transaction carrying
`app.tenant_id`, which the Row-Level Security policies from #63 read back. The
two are welded together deliberately: a request that reached a query with no
context set would see nothing, and the way to make that unreachable is to give
the middleware that knows the tenant the job of opening the context.

### 2. Corroborate against `Origin` — public routes

Under the subdomain scheme the origin *contains* the tenant
(`https://acme.reservetoday.app`), a browser sets it, and a page cannot lie
about it. So a header that disagrees with the origin is refused outright, before
either is resolved — which means a forged header naming a studio that exists and
one naming a studio that does not are refused identically, and the response
cannot be used to enumerate tenants.

An origin that names **no** tenant refuses nothing, and this is load-bearing
rather than a gap:

- the frontend proxies call the backend server-side, and a server-side `fetch`
  sends no `Origin` at all;
- `http://localhost:3000` and the bare root domain are allowlisted but
  single-tenant;
- an origin outside every pattern has already been refused by CORS.

None of the three is evidence about which tenant the caller meant, so none may
override the header.

Patterns come from `TENANT_ORIGIN_PATTERNS` and the wildcard is the **leftmost
label, exactly one label deep** — the boundary the certificates already enforce
(RFC 6125), which is why `a.b.reservetoday.app` is unserveable in production and
is not allowlisted here either. `lib/origin.ts` is the matcher; the same
allowlist backs CORS, this check, and the Clerk `azp` check, because if the three
disagreed one would become the hole in the other two.

### 3. Corroborate against the Clerk Organization — authenticated routes

Each tenant is one Clerk Organization in the **portal** application, its id on
the tenant row (`clerk_portal_org_id`). A session token carries the organization
the user is active in, inside a signature — the one statement about tenancy on
the request that the caller cannot forge.

**The client application has no organizations, and member requests skip this
step entirely.** A studio's members are hundreds of people and Clerk prices
organization membership per seat, so `clerk_client_org_id` is null on every
tenant and stays null; a member request is corroborated by `Origin` (step 2) and
fenced by Row-Level Security. `middleware/clerk-client.ts` therefore does not
call `assertTenantOrgClaim` at all: with no tenant configuring a client
organization the check could never *grant* anything, and a member still holding a
membership in some leftover organization would be refused `tenant_mismatch` on
every request, permanently. The table below is the portal's.
See `docs/adr/0003-no-client-side-clerk-organizations.md`.

`services/tenants/org-claim.ts` decides, and both Clerk middlewares call it:

| Token's organization | Tenant's configured org id | Verdict |
|---|---|---|
| this tenant's | anything | proceed |
| another tenant's | anything | **403 `tenant_mismatch`** |
| unknown to the platform | anything | **403 `tenant_mismatch`** |
| none | none | proceed |
| none | set | **403 `organization_required`** |

The last two rows are the rollout seam, and it is deliberately one-way: while a
tenant has no organization provisioned, tokens without the claim work; the moment
the id is written to its row, they stop. Enforcement turns on by writing a row,
not by deploying.

⚠️ **That switch locks out any token with no *active* organization**, and Clerk
does not always auto-activate a user's single membership — it depends on the
front end's organization settings. Before writing an org id onto a tenant row,
confirm that app mints tokens carrying `o.id`. The escape hatch is the same
switch in reverse: setting the column back to `NULL` restores the permissive
half of the table immediately (the memo's TTL is 60s, or call
`forgetCachedTenants`). There is no deploy in either direction.

The two columns are distinct namespaces and are never searched across — a staff
token naming a *member* organization must not resolve. `clerk_client_org_id` is
kept, unused and null, so that decision is reversible by backfill rather than by
schema change.

**This is the portal's membership enforcement.** A staff member of one studio
reaching another studio's portal presents a token whose organization belongs to
their own, and is refused before their `staff_users` row is even read. The row
lookup then runs inside the tenant's RLS context, so a row from another studio is
unreachable rather than merely wrong; `tenantMatches` says so out loud anyway.

### 4. Corroboration gates provisioning, not just reading

Reads are fenced by Row-Level Security: a header naming another studio finds
nothing. Writes are the gap that leaves, and there is exactly one write a
*request* can trigger without already being a member — the auto-provisioning in
`middleware/clerk-client.ts` (and the pending-invitation link in
`clerk-staff.ts`). Left ungated, a member of studio A with a valid token and
`X-Tenant-Slug: B` would fail the scoped lookup and then be handed a brand-new
membership at B. The forged header would not merely fail to read; it would write.

So provisioning requires that something other than the header vouched for the
tenant — `tenantCorroborated()` in `middleware/tenant.ts`:

| Situation | Corroborated |
|---|---|
| `Origin` named this tenant | yes |
| the organization claim named this tenant | yes |
| the request named no tenant at all (tenant #1 fallback) | yes — nothing was claimed, so nothing was forged |
| the header is the only statement | **no** — the caller gets `client_not_found`, and nothing is written |

The third row is what preserves today's behaviour exactly: pre-tenancy clients
send no header and provision as they always have.

### 5. Authorized parties

Clerk's own `authorizedParties` option is an exact-match list of origins, and
under multi-tenancy the valid set is `{slug}.portal.…` for every slug that
exists — a list that changes whenever a studio is created, and which would sign
staff out of a tenant created overnight. So `verifyToken` is called without it
and `lib/allowed-origins.ts` checks `azp` against the same wildcard allowlist
CORS uses. `CLERK_STAFF_AUTHORIZED_PARTIES` still contributes any extra exact
origins an environment wants to pin.

A token with no `azp` passes, matching Clerk's own behaviour: the claim only
appears on tokens minted by a front end that sets it.

## Webhooks

### The decision

> **The Clerk Organization is the authority. `user.*` events are identity only,
> and an event that names no studio is a logged no-op — never a guess.**

The Clerk webhook is one endpoint serving both Clerk applications; the payload
cannot say which application sent it, and the signing secret disambiguates.
Multi-tenancy repeats that a level deeper: a `user.created` payload carries no
organization, yet the handler inserts a row that requires a `tenant_id`.

Three candidates were on the table. What separated them was the case the spec
explicitly wants to work — **one person, two studios**:

| Approach | Two studios | Why not chosen |
|---|---|---|
| **Organization events** | Two memberships → two rows, natively | *chosen* |
| Tenant in sign-up metadata | Works at sign-up; says nothing when the second studio is joined later, and the browser sets it | kept as a **secondary** signal, below the organization |
| An endpoint per tenant | Works, but every tenant needs a Clerk dashboard change and a new signing secret — i.e. infrastructure per tenant, which is the one thing this plan exists to avoid | rejected |

### How it resolves

`services/auth/webhook-tenant.ts`, in order — each a different *kind* of
evidence, not a fallback for the same one:

1. **The organization on the event.** `organizationMembership.created` says
   exactly which studio a person just joined, in a payload Clerk signed. This is
   the only source that may create a row. An organization the platform does not
   know **stops** resolution rather than falling through, so a stray metadata
   slug can never decide an event that named a studio.
2. **`tenant_slug` in the user's metadata**, stamped by the front end at sign-up
   (`public_metadata` preferred over `unsafe_metadata`, since the browser writes
   the latter). A statement of intent, not of membership.
3. **The tenants that already hold a row for this Clerk user.** This is what
   makes `user.updated` reach *both* records of a two-studio member. It can never
   create one.

That third lookup is a cross-tenant read the application role is not allowed to
do, so — exactly as migration 0034 did for the payment provider — migration 0035
exposes it as `SECURITY DEFINER` functions that return tenant ids and no row
data, with a pinned `search_path` and `EXECUTE` revoked from `PUBLIC`.

Staff events get one extra source, because staff rows are always pre-seeded or
invited and never self-registered: an email that already exists in `staff_users`
names the studio that invited it. That is a membership fact, and it is what lets
an invitation accepted before the Clerk organization exists still link.

### What happens when nothing resolves

The event is a no-op, logged at `warn`, answered `200` so Svix does not retry.

For a member this is not a gap. `middleware/clerk-client.ts` provisions the row
on the member's first authenticated request, from a tenant that request
*proved* — resolved from the header and checked against the browser's own
`Origin` — rather than one the webhook guessed. That path already carries
production today; the webhook is an accelerator, not the only door.

The pre-tenancy handler filed such a user under tenant #1. It no longer does,
and that is the point: a default here would be the one place every check above
could be bypassed.

`organizationMembership.deleted` is deliberately **not** handled. Removing
someone's access is the studio's own archive/block action in the portal, which
already does the Clerk side; making a webhook soft-delete rows would give Clerk's
retry semantics the ability to blank a studio's member list.

## One person, two studios

`clients` and `staff_users` were born single-tenant, so `clerk_user_id` and
`email` were unique across the whole platform — which is the same sentence as
"nobody may be a member of two studios", failing at sign-up as a duplicate-key
error rather than as anything a person could understand.

Migration 0035 widens all four to `(tenant_id, …)`. Nothing needed backfilling: a
narrower unique cannot have admitted a row the wider one refuses. Reads did not
change either, because every one of them already runs inside a tenant context the
policies enforce — the same person's row at another studio is invisible, not
merely filtered.

`src/test/clerk-webhook-tenant.test.ts` is the proof: one Clerk user and one
email joining both studios, two rows with distinct ids, and a profile change that
reaches both.

## Environment

| Var | Meaning |
|---|---|
| `TENANT_ORIGIN_PATTERNS` | Comma-separated tenant subdomain origins, wildcard leftmost. Backs CORS, the `Origin` check and the `azp` check. Blank keeps pre-tenancy behaviour. |

Values per environment:

```
local       http://*.localhost:3000,http://*.portal.localhost:3001
staging     https://*.dev.reservetoday.app,https://*.portal.dev.reservetoday.app
production  https://*.reservetoday.app,https://*.portal.reservetoday.app
```

Set together in `.github/workflows/deploy-be.yml`, `be/.env.example` and
`be/src/env.ts`, per repo convention. `TENANT_ORIGIN_PATTERNS` is a GitHub
Environment **variable** (not a secret) in both environments.

## What this ticket did not do

- **Front-end `tenant_slug` at sign-up.** Source 2 above is read but nothing sets
  it yet; fe-client's sign-up form has to stamp it, which is that app's ticket.
- **Provisioning the Clerk Organizations.** #58 creates them and writes the ids
  onto the tenant rows; until it does, the organization checks are the permissive
  half of their table by design.
- **Stripe.** The payment webhook has the same shape and resolves its own tenant
  off the signed payment intent already (migration 0034); Connect is Phase 4.
