# Backend Tenant Resolution

> Recorded 2026-08-31 for #65 (parent spec #55). Companion: `multi-tenancy-plan.md` Phase 2.
> Status: **implemented.** Authentication sections rewritten for self-hosted auth (#121,
> `docs/adr/0004-self-hosted-auth-with-better-auth.md`).

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

`middleware/tenant.ts` runs on every `/api/v1/*` path except the ones that
resolve their own tenant or must not touch the database (`healthz`, the slug
lookup, the payment webhook, the super portal branch and its auth pool).

### 1. Resolve

| Present | Tenant |
|---|---|
| `X-Tenant-Slug` | that slug |
| `Origin` naming a tenant, no header | the origin's tenant |
| both, agreeing | that tenant |
| both, disagreeing | **403 `tenant_mismatch`** |
| neither | **400 `tenant_required`** |

The last row used to read "tenant #1" — a compatibility seam for clients that
predated tenancy and sent no header. It has been closed. The seam only ever made
sense while "no tenant" and "the tenant" named the same studio; after the second
one existed, what it actually did was answer a request that had forgotten to say
whose data it wanted with somebody's data anyway. A caller cannot detect that: it
receives a well-formed, plausible answer about the wrong studio.

Nothing legitimate lands on that row. Every path that genuinely carries no tenant
is exempted before this middleware runs — `healthz`, the payment webhook, the
whole super portal branch, and the slug lookup — so an absent tenant is a bug in
the caller, and 400 is what turns it into one somebody fixes.

A slug resolves only if it is a Tenant's **current** slug. A renamed studio's
former slug (`former_slugs`, kept 90 days) is a 404 here, from the header and
from `Origin` alike, so nothing authenticated ever runs on an old host. The only
thing that reads a former slug is the public slug lookup the frontends' proxies
call: it answers `{ moved_to: { slug } }`, and the proxy sends a 308 to the
same path and query on the new host. See `be/CONTEXT.md` § Former slug.

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
- `http://localhost:3000` and the bare root domain are allowlisted but name no
  tenant of their own — a request carrying only one of these and no header is
  refused `tenant_required` rather than resolved;
- an origin outside every pattern has already been refused by CORS.

None of the three is evidence about which tenant the caller meant, so none may
override the header.

Patterns come from `FRONTEND_URLS` and the wildcard is the **leftmost
label, exactly one label deep** — the boundary the certificates already enforce
(RFC 6125), which is why `a.b.reservetoday.app` is unserveable in production and
is not allowlisted here either. `lib/origin.ts` is the matcher; the same
allowlist backs CORS, this check, and the auth pools' trusted origins, because if
the three disagreed one would become the hole in the other two. An environment
that needs an extra exact origin puts it in the same variable.

### 3. Corroborate against the session claim — signed-in requests

Sessions are Better Auth bearer tokens from one of three pools — `client`
(members), `staff` (studio portals), `platform` (the super portal) — each on its
own tables. `middleware/client-auth.ts` (`clientAuth`) reads a `client` session,
`middleware/staff-auth.ts` (`staffAuth`) a `staff` one, and the super portal's
gate a `platform` one. A token its pool has no session for is **401
`invalid_token`**, whatever its shape.

A studio-pool session (`client` or `staff`) is created on a studio hostname,
inside the Tenant context this resolution opened, and a session-create hook writes
that Tenant onto the row as `claimed_tenant_id`. A sign-in that names no studio
never gets that far (`tenant_required`), and the hook refuses one that somehow
does. `services/tenants/session-claim.ts` decides, and **both** studio
middlewares call it through `assertTenantSessionClaim` — members get the same
check as staff:

| Session's claim | Verdict |
|---|---|
| this tenant | proceed (not counted as corroboration — a sign-in may have resolved from the header alone) |
| another tenant | **403 `tenant_mismatch`** |
| none | **403 `tenant_required`** |

There is no rollout seam: every studio-pool session is stamped, so a missing claim
proves nothing. A staff member of two studios is one user with a `staff_users` row
at each and a session per hostname; after the claim, the row for the resolved
tenant must exist (`staff_not_provisioned`) and be active (`staff_inactive`). A
member's `clients` row must exist (`client_not_found`) and not be blocked. There
is no auto-link or auto-provision: invitations, seeds and member registration
write `auth_user_id` themselves, and it is `NOT NULL` (migration 0052).

The row lookup then runs inside the tenant's RLS context, so a row from another
studio is unreachable rather than merely wrong; `tenantMatches` says so out loud
anyway.

The pools are separate tables, so a session from one pool is unknown to the
others: a member session on the portal, a staff session on `/me`, and a platform
session on either are **401**; a studio session on `/api/v1/platform/*` is the
usual **404 `not_found`**. `src/test/isolation-sessions.test.ts` proves each of
these over real HTTP, using the harness's `signInAs(pool, email, tenant)`.

### 4. Corroboration gates writes a header could buy

Reads are fenced by Row-Level Security: a header naming another studio finds
nothing. Writes are the gap that leaves: a write that makes someone part of a
studio must not happen on the strength of a header alone. `tenantCorroborated()`
in `middleware/tenant.ts` answers whether anything but the header vouched:

| Situation | Corroborated |
|---|---|
| `Origin` named this tenant | yes |
| the request named no tenant at all | n/a — refused at resolution with `tenant_required` |
| the header is the only statement | **no** |

A matching session claim does not count, for the reason in step 3. Neither
authenticated middleware provisions anything any more, so nothing on the
signed-in path needs the gate today.

The second row used to say "yes — nothing was claimed, so nothing was forged",
and that reasoning was backwards. It made the one request naming no studio at
all the one request permitted to write into a studio it had never mentioned. It
no longer reaches this check at all.

## Webhooks

The only webhook is the payment provider's. It resolves its own tenant off the
signed payment intent (migration 0034), so it is exempt from `resolveTenant`, and
an event that names no studio is a logged no-op — never a guess.

## One person, two studios

`clients` and `staff_users` were born single-tenant, so their identity column and
`email` were unique across the whole platform — which is the same sentence as
"nobody may be a member of two studios", failing at sign-up as a duplicate-key
error rather than as anything a person could understand.

Migration 0035 widened them to `(tenant_id, …)`, and `auth_user_id` followed the
same shape (`(tenant_id, auth_user_id)`). Nothing needed backfilling: a narrower
unique cannot have admitted a row the wider one refuses. Reads did not change
either, because every one of them already runs inside a tenant context the
policies enforce — the same person's row at another studio is invisible, not
merely filtered. One auth user holds one row per studio;
`src/test/member-sign-in.test.ts` shows a member joining a second studio with the
same account.

## Environment

| Var | Meaning |
|---|---|
| `FRONTEND_URLS` | Comma-separated tenant subdomain origins, wildcard leftmost, plus any exact origin an environment needs. Backs CORS, the `Origin` check and the auth pools' trusted origins. |

Values per environment:

```
local       http://*.localhost:3000,http://*.portal.localhost:3001
staging     https://*.dev.reservetoday.app,https://*.portal.dev.reservetoday.app
production  https://*.reservetoday.app,https://*.portal.reservetoday.app
```

Set together in `.github/workflows/deploy-be.yml`, `be/.env.example` and
`be/src/env.ts`, per repo convention. `FRONTEND_URLS` is a GitHub
Environment **variable** (not a secret) in both environments.

## What this ticket did not do

- **Stripe.** The payment webhook has the same shape and resolves its own tenant
  off the signed payment intent already (migration 0034); Connect is Phase 4.
