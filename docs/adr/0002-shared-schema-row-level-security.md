# One database, `tenant_id` on every row, Row-Level Security underneath

**Status**: accepted (2026-08-31) — recorded *after* execution. Implements the model chosen in
`docs/md/research-multi-tenancy.md` §5.1 and executed across issues #59, #63 and #65. Spans all
three applications, which is why it lives in the root `docs/adr/` rather than in `be/docs/adr/`.

A studio on this platform is a **Tenant**, and creating one is a single `INSERT` into `tenants` —
no database, no schema, no DNS call, no deploy. Every domain table carries a `tenant_id` column,
every service query is scoped by it, and Postgres Row-Level Security refuses the rows anyway if a
query forgets. One Postgres database serves every studio.

## Why not a database or a schema per Tenant

**A database per Tenant** gives the strongest isolation available and was rejected on operating
cost, not on safety. The backend is one Hono process on one VPS with one connection pool; N
databases means N pools or a router in front of them, migrations that run N times and can succeed
on some and fail on others, and a `tenants` directory that has to live *somewhere* outside them
all. Onboarding stops being an insert and becomes provisioning — which is exactly the property
this platform is built to avoid, since the whole URL scheme rests on a new studio working the
moment its row exists.

**A schema per Tenant** was rejected for the same reasons in a milder form, plus one of its own:
Drizzle's schema definitions are static TypeScript, and a per-Tenant `search_path` makes the ORM's
type-level view of the database a lie that only shows up at runtime. It also caps the platform on
`pg_class` bloat long before the business would.

**Row scoping with no RLS** — `WHERE tenant_id = ?` and nothing else — was rejected because it is
one forgotten clause away from a cross-Tenant leak, in a codebase with 53 domain tables and a
query surface that grows every sprint. That failure is silent: the query returns *more* rows, not
an error, so nothing fails a test and nothing pages anyone.

Shared schema plus RLS is the current default for B2B SaaS of this shape, and it is what both
Vercel (for tenants with identical functionality) and Clerk (Organization id stored alongside each
resource) document as the low-complexity path.

## The shape as built

- **`tenant_id` on all 53 domain tables** (migrations 0026–0032), including pure join tables —
  RLS needs a column on every table to key a policy on. `NOT NULL` with **no default**: an insert
  that does not name its Tenant fails loudly rather than filing someone else's row under Tenant
  #1. Every non-unique index leads with it.
- **One policy per table** (migration 0033), `ENABLE` **and** `FORCE`, keyed on
  `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`. The `true` argument
  means an absent setting yields `NULL` rather than an error, and `nullif` covers the empty string
  a reset leaves — so an unset context makes the policy *false* (no rows, `INSERT` refused), never
  an exception. A policy that raises is a policy someone eventually disables.
- **Transaction-local context.** `withTenant` (`be/src/db/index.ts`) writes `app.tenant_id` with
  `set_config(..., true)` inside the transaction. Session scope would ride a pooled connection
  into the next request — the precise failure this design exists to make impossible.
- **`tenants` and `tenant_settings` are excluded on purpose.** Slug resolution reads them *before*
  any Tenant context exists, so a policy keyed on that context could only refuse the request that
  establishes it. Column-level `GRANT`s stand in for `tenant_settings`: the app role may read the
  branding a studio publishes and nothing else, so mail-from identity and waiver text are
  unreadable across Tenants. The grant is by column name, so a column added later is invisible
  until someone declares it public (`be/src/db/roles.ts`).
- **Narrow, owner-owned exemptions for callers with no Tenant.** A webhook arrives on a hostname
  carrying no Tenant, and finding its owner is a cross-Tenant read. Migrations 0034 and 0035 add
  `SECURITY DEFINER` functions that take a signed routing key and return Tenant ids and nothing
  else; everything after runs inside `withTenant`. Deliberately narrow steps rather than a
  standing `BYPASSRLS`.

## The constraint that makes it real

**The application must not connect to Postgres as the table owner, and must never be a
superuser.** Postgres exempts superusers from RLS unconditionally and table owners unless the
table is `FORCE`d. So the server connects as `booking_app` — provisioned by `be/src/db/roles.ts`,
`NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, owning no tables, holding DML and no DDL —
through `DATABASE_APP_URL`. `DATABASE_URL` is the owner role and is used for migrations and seeds
only, which is how those legitimately write across Tenants.

This is the single most reversible-by-accident decision in the whole model, and reverting it is
**invisible**: point the running server at `DATABASE_URL` and every policy in 0033 evaluates to
"allowed", every request still succeeds, and every test still passes. There is no error, no log
line and no failed query — only a platform where every studio can read every other studio's
members. `DB_APP_PASSWORD` is therefore a required environment secret in both GitHub Environments
and the backend fails Zod validation at boot without it, which is the intended failure for a
missing security control.

## Consequences

- Creating a Tenant is a row insert. The super portal needs no infrastructure API, and the
  wildcard DNS in ADR 0001 means the new studio's URLs work immediately.
- Isolation is enforced twice — once in every service query, once by the database — and the second
  one is the one that holds when a developer forgets the first.
- Every table added from here on **must** carry `tenant_id` and get a policy, and every deploy
  re-runs the grants, because `GRANT … ON ALL TABLES` only covers the tables that existed when it
  ran.
- Nothing in the application can produce a platform-wide figure. Cross-Tenant reporting, if it is
  ever wanted, is a separate deliberate mechanism — not a query someone writes one afternoon.
- Noisy-neighbour behaviour is shared: one studio's expensive report competes for the same
  Postgres. Acceptable at the scale this platform is planned for (< 100 studios), and the point at
  which it stops being acceptable is the point to revisit the per-database option.
- RLS costs a planning step per query. Every non-unique index leads with `tenant_id` so the policy
  predicate is satisfied by the same index the query already wanted.
