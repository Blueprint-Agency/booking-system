# Platform settings: one row no studio owns, readable by all, writable only outside a Tenant

**Status**: accepted (2026-10-08). Introduced with Maintenance mode (migration 0104,
`be/src/services/platform/maintenance.ts`). Spans all three applications — the backend enforces the
switch and both frontends show it — which is why it lives in the root `docs/adr/`.

## Why

Maintenance mode is one switch for the whole platform: while it is on, every studio's member app
and portal answer `503 maintenance`, and the super portal stays open to switch it off. Its state
has to survive a restart and be shared by every backend process, so it lives in the database. Until
now nothing in the database belonged to the platform itself; every row was a studio's, or (in
`tenants`, `former_slugs`, the `platform` auth pool and the null rows of `auth_events`) about
studios or the super portal's own logins.

## The decision

A table `platform_settings` with **one row**, enforced by its key (`id boolean PRIMARY KEY DEFAULT
true CHECK (id)`). No row reads as the defaults, so a fresh database needs no seed.

**No `tenant_id`.** The row is nobody's, and a column that every row would have null is not a
Tenant column. So `ensureTenantIsolation` passes it by, as it passes `tenants`, `former_slugs`
and the `platform_auth_*` tables. It is not a **Platform row** (`PLATFORM_ROWS`): that is a null in a
table whose other rows are studios'.

**Row-Level Security of its own** (migration 0104), because without one the app role's default
DML grant would let any code running inside a studio's context switch every studio off:

| Policy | For | Rule |
|---|---|---|
| `platform_read` | `SELECT` | always — the gate reads the switch on tenant-facing requests, and it holds nothing about any studio |
| `platform_write` | all | only with no Tenant context open (`app.tenant_id` unset) |

That is the reading ADR 0002 and `PLATFORM_ROWS` already give "no Tenant context": it is where the
super portal runs, and a studio's request never runs there. Inside a context an `UPDATE` matches no
row and an `INSERT` is refused. `FORCE`d, so the owner is held to it; migrations run as a superuser
and are not.

## Considered

- **An environment variable.** No restart-free toggle, and each process would hold its own answer.
- **A column on `tenants`, or a per-studio flag.** The switch is for deploys that touch every studio
  at once; a per-studio one would be a second Suspension.
- **Leaving it unpoliced, like `tenants`.** `tenants` is written by the super portal alone too, but
  only through services that run outside a context; nothing in the database says so. For a switch
  that closes every studio at once the database should say so.
- **Revoking the app role's write grant** and writing through a `SECURITY DEFINER` function. Same
  guarantee, more moving parts: the super portal already connects as the app role outside a context.

## Consequences

- A later platform-wide setting is a column here, not a new table, and inherits both policies.
- The rls-coverage tests are unchanged: they police tables with a `tenant_id`, and this has none.
  `be/src/test/maintenance-mode.test.ts` (TEN-33) proves the read-anywhere, write-outside rule as the
  app role.
