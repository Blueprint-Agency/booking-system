# Audit rows are never deleted: anonymised on member erasure, archived on studio deletion

**Status**: accepted (2026-10-08). Decided in #375; migration 0106 (`audit_log_archive`),
`be/src/services/clients/erase-audit-row.ts`, `be/src/services/tenants/delete.ts`. It spans member
erasure (a studio's portal) and studio deletion (the super portal), so it lives in the root
`docs/adr/`.

## Why

`prd.md` §3.9 says the audit log takes no row deletes, even by super-admin. Two acts deleted audit
rows anyway: permanently deleting a member (#144) took every `audit_log` row that named them, and
deleting a studio took all of its own. The choice was between writing those exceptions into the
PRD, or keeping the rows. **The rows are kept.**

## The decision

**Member erasure anonymises.** Every `audit_log` row that names the erased member stays, with the
same id, actor, actor type, target table and time. Their personal data in it is replaced with the
placeholder `[erased member]`: their ids in `action`; `target_id` set to the nil id when it was their
`clients` row (a uuid column cannot hold text); in `payload`, every value of `from` and `to` on a row
about their own record (earlier names, phones and emails included), and every occurrence of their
name, email, phone or ids in any other string. Keys stay, so an edit still says which fields
changed. This is the one edit ever made to an audit row, and it removes personal data only. It is an
`anonymise` erase step in `MEMBER_TABLES`, so export and erasure still read one list.

**Studio deletion archives.** Inside the delete's own transaction, before any row goes, the studio's
`audit_log` rows are copied into `audit_log_archive`, then deleted with the rest of the studio. Each
archived row is the original, field for field, except that `tenant_id` becomes
`former_tenant_id`, `former_tenant_slug` and `former_tenant_name` (plain values, no foreign key) plus
`former_tenant_deleted_at`. `actor_staff_id` keeps its value with no foreign key either. A delete
that fails part-way rolls the archive back with everything else.

**The archive is the platform's, not a studio's, and its column is named so.** The studio is
`former_tenant_id`, never `tenant_id`, following `former_slugs.renamed_tenant_id`. Every sweep that
finds studio data by the `tenant_id` column name therefore passes it by: Row-Level Security's
`ensureTenantIsolation`, the studio export, restore and delete (`tenantTableOrder`), member export
and erasure (`MEMBER_TABLES`'s guard), and the whole-studio row counts in the tests. It is not a
**Platform row** table (`PLATFORM_ROWS`) either: that is for a nullable `tenant_id` whose null rows
are the platform's, and here no row belongs to a live studio.

**Row-Level Security of its own** (migration 0106), as `platform_settings` has (ADR 0007). Without it
the app role's default DML grant would let any studio's request read every deleted studio's trail:

| Policy | For | Rule |
|---|---|---|
| `platform_read` | `SELECT` | only with no Tenant context open, which is the super portal |
| `studio_archives_its_own` | `INSERT` | only inside the context of the studio the row names, which is where the delete runs |
| none | `UPDATE`, `DELETE` | so never, from any context |

`FORCE`d, so the owner is held to it; migrations run as a superuser and are not. The delete inserts
with no `RETURNING`, since inside the studio's context it can write the archive but not read it.

## Considered

- **Exceptions in the PRD.** Honest about the code, but it leaves a studio's trail in the hands of
  the act that most needs one on record, and a member's erasure removing what staff did to their
  account.
- **Deleting the member's rows but keeping a count.** Loses who acted and when, which is what the
  trail is for.
- **Nulling `tenant_id` on the studio's `audit_log` rows and listing the table in `PLATFORM_ROWS`.**
  The rows would then read as the super portal's own, mixed with a live table every studio writes,
  and the slug and name of the studio they came from would be lost with the `tenants` row.
- **A `tenant_id` column on the archive.** The sweep would police it with `tenant_isolation` and
  treat it as studio data: exported with a studio, deleted with one.

## Consequences

- `auth_events` (the sign-in audit log) is not covered: a member's sign-ins still go on erasure, and
  a studio's on deletion. §3.9 is about the staff audit trail.
- The archive has no purge and no reader yet: the super portal has no view of it. Its rows keep any
  personal data the trail held when the studio was deleted, since there is no studio left to erase a
  member at; a later erasure request for a deleted studio's member is a manual job.
- A studio restored from an export made before its deletion brings back the trail that export
  held, as a new studio; the archive keeps its own copy under the former id.
- Tests: AUD-07 (`be/src/test/member-delete.test.ts`), AUD-08 to AUD-10
  (`be/src/test/tenant-delete.test.ts`), and the catalogue guard in `be/src/test/rls-coverage.test.ts`.
