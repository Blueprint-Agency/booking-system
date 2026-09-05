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
}

export type TenantArchive = {
  manifest: TenantManifest
  /** Table name → its rows, as returned by Postgres. */
  rows: Record<string, Record<string, unknown>[]>
}

/** A file the operator handed us that we cannot use, and why. */
export class ArchiveError extends Error {}
