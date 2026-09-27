# A studio's logins are its own: the same email at two studios is two accounts

**Status**: accepted (2026-09-24). Records #231 (part of #228, "Per-studio logins").
**Amended** (2026-09-28): an export may carry password hashes when the operator asks for them — see
"Export with passwords" below.
**Supersedes** the section "Why the auth user tables carry no `tenant_id`" of
[ADR 0004](0004-self-hosted-auth-with-better-auth.md), and the paragraph of
[ADR 0005](0005-member-passwords.md) that says accounts stay one per email per pool, platform-wide.
Everything else those two decide stands: three pools, bearer sessions, the Session claim, no
provisioning on first request, Impersonation, email-first sign-in and the set-password link.

## Why

One login per email served every studio a person belonged to. So something done at one studio
reached another:

- A member who registered at studio B **replaced the password they used at studio A**.
- A sign-up code requested at studio A **registered the member at studio B**, because the code was
  keyed on the email alone.
- A staff member who reset their password at one studio **changed it at every studio**.
- Second factors, reset links and the "you already have a password" shortcuts leaked the same way.

Studios are independent businesses, and ADR 0002 walls every Tenant's data off from every other
Tenant's. Logins were the one exception.

## The decision

Three walls, nothing shared:

| Pool | Who | Accounts |
|---|---|---|
| `platform` | Super portal operators | One per email, platform-wide. Unchanged. |
| `staff` | Studio portals | **One per studio per email.** |
| `client` | Member app | **One per studio per email.** |

The same email at two studios is two independent accounts, each with its own password, second
factor, sessions, Set-password links and sign-up codes. Nothing done at one studio — a reset, a
sign-up, a block, a deletion, an email change — reaches another.

### How

- **The nine `staff` and `client` tables carry a `tenant_id`**, `NOT NULL`, referencing `tenants`
  with delete restricted. Users are unique on (Tenant, email).
- **The column defaults to the Tenant context** (`app.tenant_id`) — a deliberate exception to the
  "no default on `tenant_id`" rule. Better Auth writes sessions, credentials, verifications and
  second factors itself and cannot be told a Tenant. Outside a Tenant context the default is null,
  so a write there still fails on `NOT NULL`, loudly.
- **Row-Level Security needed no new code.** `ensureTenantIsolation` fences every table with a
  `tenant_id`, found by name, and Better Auth already runs inside the request's Tenant transaction.
  So every lookup it makes — the user at sign-in, the code at registration, the token at reset — is
  this studio's, and a query with no context finds nothing.
- **`ensureAuthUser` takes the Tenant** for the studio pools and conflicts on (Tenant, email).
- **A member's email change replaces this studio's login**: a fresh login for the new address, and
  the old one deleted with its password and sessions.
- **Member deletion and Tenant deletion delete the studio's own logins directly.** The cross-Tenant
  `SECURITY DEFINER` checks from migrations 0060 and 0072 are no longer called. Migration 0079
  dropped them, with the single-column `auth_user_id` indexes that served them, once this code was
  in production (#258).
- **Export never carries logins, and restore makes fresh ones** (#229). An archive holds no
  password hash, second factor, session or verification. Restoring it — or importing a studio from
  Mindbody — gives every member and staff member a fresh login with no password, and they get back
  in through the email-first sign-in step, which mails them a link to set one. That link, opened
  from an inbox, needs no Tenant context (#230). The one exception follows.

### Export with passwords

Moving a studio between environments — staging to production — with the export above sent every
member and staff member a Set-password link on arrival, for passwords they already had. So the
super portal's export takes an opt-in, **Include passwords** (`?include=passwords`):

- **Only the password hash travels**, by email, in `logins/passwords.json` beside the tables: the
  credential of each login a `clients` / `staff_users` row names. A hash is checked with no secret
  of the platform's (Better Auth's scrypt, or a bcrypt digest from the previous provider), so it
  signs in on another environment. **A second factor does not travel**: its secret is sealed with
  `BETTER_AUTH_SECRET`, which each environment has its own of, so staff enrol their authenticator
  again. Sessions and verifications are one environment's and stay behind.
- **The import only fills an empty login.** Each of the archive's people whose login at the target
  studio has no password takes the archive's hash; one that already has a password keeps it, so a
  Replace from archive never changes a password someone has. After arrival the target's copy is its
  own, as any per-studio login is.
- **Recorded on both sides**: the export in the source studio's `audit_log`
  (`tenant.exported_with_passwords`), the import in the target's (`tenant.passwords_imported`), by
  a `system` actor naming the operator. The file is named `-with-passwords`, and the super portal
  says to delete it once restored.
- **Off by default.** A routine backup carries no passwords, as before. A Mindbody build has none.

The trade-off is a file of password hashes on an operator's disk. It is no worse a disclosure than
the member rows beside it, but a hash can be attacked offline, so it is asked for by name, for the
move it serves, and not kept.

### The Session claim

`claimed_tenant_id` stays, and always equals the session's `tenant_id`. A studio-A token presented
at studio B no longer reaches the claim check: B's context cannot see the session at all, so the
answer is `401 invalid_token` rather than `403 tenant_mismatch`. The claim check stays as the belt
to Row-Level Security's braces. In a browser neither is reachable, because a token is held per
origin.

### Migration

Migration 0076 splits existing shared logins. Each login stays with the studio of the person's
earliest `staff_users` / `clients` row. For every other studio, it is copied — name, password,
second factor — and that studio's row and the sessions claimed there move to the copy. Nobody is
locked out, and from then on the copies change independently. Logins no studio has a row for are
deleted. Sessions with no claim, or claimed on a studio their login is not at, end. Verifications
are deleted; they live for minutes.

Dropping the global email unique breaks the previous build's insert-on-conflict. During the deploy
window, or on a rollback, invites and member registration on the old image error. This breaks the
"migrations only add" rule on purpose: the product is pre-launch and production is empty.

## Consequences

- A person at two studios has two passwords, and sets up the second one there. The first studio's
  password never signs in at the second.
- The email-first step answers "password" only when the address has a password **at this
  studio**. It reveals nothing about other studios.
- Per-email rate limits count per Tenant and email (#230).
- A staff member invited to a second studio sets a password for it through the invitation link.

## Considered and rejected

- **Keeping one account and adding per-studio passwords on it.** Still one row answering for many
  studios, with every lookup having to remember to pick the right studio's password. The column
  plus Row-Level Security makes the wrong answer unreachable instead.
- **Linking accounts across studios** (a "same person" concept, single sign-on). Out of scope: no
  studio should be able to learn whether its member is also someone else's.
- **Carrying whole logins through export and restore, encrypted or not.** Second factors, sessions
  and verifications do not travel. Password hashes alone may, when asked for (see "Export with
  passwords").
