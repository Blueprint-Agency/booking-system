# Self-hosted auth with Better Auth: three pools, bearer sessions, the Tenant on the session

**Status**: accepted (2026-09-14). Records #106, delivered across #112–#121. Spans the backend and
both frontends, which is why it lives in the root `docs/adr/` rather than in `be/docs/adr/` (whose
own `0004` and `0005` are unrelated — ADR numbers are per context). **Supersedes
[ADR 0003](0003-no-client-side-clerk-organizations.md)**, and amends ADR 0002's account of how a
request proves which Tenant it is about. **Its member sign-in is superseded by
[ADR 0005](0005-member-passwords.md)** (members sign in with email and password).

Authentication runs in our own backend, on our own Postgres, through
[Better Auth](https://www.better-auth.com). Clerk is gone: no vendor SDK, no webhook, no
Organization, no `clerk_user_id`.

## Why

- **The Tenant check lived in a vendor feature.** A staff request was corroborated by the Clerk
  Organization claim inside the token. That was the one Tenant statement a caller could not forge,
  and it was a priced product.
- **The member side could not afford it.** Clerk prices Organization membership per seat and a
  studio has hundreds of members, so ADR 0003 took organizations off the member application and
  left member requests with `Origin` and Row-Level Security alone.
- **The rental sat in the middle of everything.** Three applications, two signed webhooks, an
  organization per Tenant row, impersonation by sign-in ticket, auto-provisioning on first request
  because a webhook might be late — and 117 source files that named it.
- **The cost curve was wrong for a multi-tenant platform.** Every studio's members were monthly
  active users on one bill.

## The decision

### Three pools, not one

`services/auth/better-auth.ts` runs three Better Auth instances, each over its own tables
(`db/schema/auth.ts`) on its own base path:

| Pool | Who | Path | Sign-in |
|---|---|---|---|
| `client` | members | `/api/v1/auth/client` | emailed one-time code; the first code creates the account — **superseded by [ADR 0005](0005-member-passwords.md)**: email + password, first password through a mailed link |
| `staff` | studio portals | `/api/v1/auth/staff` | email + password, TOTP / backup / emailed second factor; invitation-only |
| `platform` | the super portal | `/api/v1/auth/platform` | as staff, on a pool no studio can write |

Separate pools are the property the three Clerk applications gave us, kept by table: a member can
never sign into a portal, and a studio superadmin's credentials do not exist in the pool the super
portal reads. A token one pool issued is a row the other two have never seen.

### Bearer tokens, not cookies

The API (`api.reservetoday.app`) and the frontends (`{slug}.reservetoday.app`,
`{slug}.portal.reservetoday.app`, `admin.portal.reservetoday.app`) are different sites. A session
travels as `Authorization: Bearer <token>`, returned in the `set-auth-token` header and held per
origin by the browser. So each hostname holds its own session — a staff member of two studios is
signed in separately at each — and signing out of one leaves the others. `readPoolSession` hands
Better Auth the `Authorization` header only, so a stray cookie can never sign anyone in.

### The Tenant is on the session

`client` and `staff` sign in on a studio's hostname, inside the Tenant context `resolveTenant`
opened. A session-create hook writes that Tenant's id onto the session row as
`claimed_tenant_id`. `staffAuth` and `clientAuth` (`middleware/staff-auth.ts`,
`middleware/client-auth.ts`) refuse a session whose claim is not the Tenant the request resolved
to — before any `staff_users` or `clients` row is read.

This keeps the guarantee the Organization claim gave staff — a statement of tenancy inside
something we signed, which the caller cannot edit — and extends it to members, which is exactly
what ADR 0003 said could not be afforded. A session from studio A is worthless at studio B, for
everyone. `platform` sessions carry no Tenant.

A matching claim does not by itself mark the Tenant *corroborated*: a sign-in can resolve from
`X-Tenant-Slug` alone, so the claim proves the session belongs here, not that a browser vouched for
"here". Nothing on the session path writes a membership, so no write gate needs it.

### Why the auth user tables carry no `tenant_id`

> **Superseded by [ADR 0006](0006-per-studio-logins.md).** The `staff` and `client` tables now carry
> a `tenant_id`: the same email at two studios is two accounts. Kept below as the record of what
> was decided first.

One person is one account per pool. A staff member of two studios is one `staff_auth_users` row
with a `staff_users` row at each studio; a member of two studios is one `client_auth_users` row
with a `clients` row at each. Those rows are platform rows, like `tenants`, and
`ensureTenantIsolation` does not fence them. The Tenant lives on the *session* — which is
per-hostname — and on the *domain* row (`staff_users.auth_user_id`, `clients.auth_user_id`, unique
per Tenant and `NOT NULL`). Putting `tenant_id` on the user would force either one account per
studio (a password per studio, and a second factor per studio) or a user that belongs to several
Tenants, which a single column cannot say.

### What goes with it

- **No provisioning on first request, no auto-link.** An account exists because a seed, an
  invitation or a member's registration made it, in the same transaction as its domain row.
- **Provisioning a studio calls nothing external.** Its first admin is a staff account, a pending
  row and an invitation nobody on its staff sent (`invited_by_staff_id` null), mailed after commit.
- **Impersonation opens a real `client` session** with `impersonated_by`, paired with a grant
  (#118).
- **Sign-in is rate-limited per address** by the pools themselves (#114).
- **Passwords moved, not reset.** The one-off import (#120) carried Clerk's bcrypt digests across;
  `verifyPoolPassword` accepts them until their owner next sets a password.

## What was rejected

**Keep Clerk and buy the member-seat add-on.** It restores the claim for members at a per-studio
recurring cost, for a check the session claim now does for nothing, and leaves every other
dependency in place.

**One Better Auth instance with a `pool` column.** Fewer tables, but the separation between a
member, a studio and the platform becomes a `WHERE` clause instead of a table boundary — the kind
of property ADR 0002 refuses to leave to a clause.

**Cookie sessions.** Cross-site cookies need `SameSite=None`, third-party-cookie tolerance and a
CSRF story, on three sites per studio. Bearer tokens need none of that.

## Consequences

- `BETTER_AUTH_SECRET` signs every session and encrypts stored second-factor secrets; rotating it
  signs everyone out and invalidates enrolled authenticator apps. `BETTER_AUTH_URL` is the
  backend's own origin, the base of every link the pools mail.
- Account recovery, abuse limits and mail deliverability for sign-in are ours to run.
- Migrations `0052` (`auth_user_id` `NOT NULL`, refusing by name while any row lacks one) and
  `0053` (drop `clerk_user_id`, `tenants.clerk_client_org_id`, `tenants.clerk_portal_org_id`)
  complete the additive-then-drop sequence begun in `0047`.
