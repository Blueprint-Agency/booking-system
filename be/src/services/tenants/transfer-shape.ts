/**
 * What a studio archive *is*, with no idea how to read or write one.
 *
 * Split out for the same reason the frontends' `lib/brand-shape.ts` is: the zip packer
 * needs these types, and importing them from `transfer.ts` would drag the
 * database connection in with them. That matters concretely — `../db` builds its
 * pool at module load, so a test that imports the packer before the harness has
 * stubbed the environment gets a pool pointed at the wrong credentials, and
 * fails on authentication rather than on anything it meant to assert.
 */

/** Bumped when the archive's shape changes in a way a reader must notice. */
export const ARCHIVE_VERSION = 1

export type TenantManifest = {
  version: number
  exportedAt: string
  tenant: { id: string; slug: string; name: string; timezone: string }
  /** Write order, parents first — the order `importTenant` replays. */
  tables: string[]
  /** Columns written NULL on the insert pass and filled afterwards. */
  deferred: Record<string, string[]>
  /** Row count per table, so a truncated archive is caught before it is written. */
  counts: Record<string, number>
  /**
   * Marks an archive built outside the platform (the Mindbody transform), whose
   * `clients` and `staff_users` rows name no login and whose links name one
   * studio's slug. The importer then lets those rows name none, and refuses any
   * studio but that one.
   *
   * Never set by an export, whose rows each name a login; one that names none is
   * still refused. Either way the importer gives every person a login made from
   * their email, never the one the row names (#229). Optional, so the archive
   * version is unchanged.
   */
  ensureAccounts?: boolean
}

export type TenantArchive = {
  manifest: TenantManifest
  /** Table name → its rows, as returned by Postgres. */
  rows: Record<string, Record<string, unknown>[]>
}

/**
 * One member's rows at one studio (#143): the same zip, for reading rather than
 * restoring — so no write order and nothing deferred, and it names the member.
 */
export type MemberManifest = {
  version: number
  kind: 'member'
  exportedAt: string
  tenant: { id: string; slug: string; name: string }
  member: { id: string; name: string; email: string }
  tables: string[]
  counts: Record<string, number>
}

export type MemberArchive = {
  manifest: MemberManifest
  rows: Record<string, Record<string, unknown>[]>
}

/** A file the operator handed us that we cannot use, and why. */
export class ArchiveError extends Error {}
