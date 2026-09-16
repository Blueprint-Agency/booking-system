import { sql } from 'drizzle-orm'
import { db, withTenant } from '../../db'
import { isUniqueViolation } from '../../db/unique-violation'
import { buildIdentityMap, remapRow } from './transfer-identity'
import { orderTables, type ForeignKey } from './transfer-order'
import { ARCHIVE_VERSION, type TenantArchive, type TenantManifest } from './transfer-shape'
import { loadTenantById } from './tenants'

// Re-exported so a caller that already reaches for the service keeps working.
// The declarations live in `transfer-shape.ts`, which carries no database
// import — see the note there.
export { ARCHIVE_VERSION, ArchiveError } from './transfer-shape'
export type { TenantArchive, TenantManifest } from './transfer-shape'

/**
 * Everything a studio is, out of the database and back into it.
 *
 * A Tenant's data is not seed data. It is the studio's own — its members, its
 * classes, its packages, its ledger — and the platform's job is to hand it back
 * on request, not to keep a copy hardcoded in a seeder. That is what this
 * module is for: one archive per studio, written by the super portal and read
 * back by it, so a studio can be taken out of the platform and put back without
 * a migration or an engineer.
 *
 * **The table list is read from the catalogue, never written down.** A table is
 * part of a studio if it has a `tenant_id` column — the same rule migration 0033
 * uses to decide what Row-Level Security covers, and the same rule for the same
 * reason: a list maintained by hand drifts, and a table missing from *this* list
 * is data silently lost on export rather than a loud error.
 *
 * **Both directions run inside `withTenant`.** Export reads under the studio's
 * own context, so Row-Level Security is what limits it to one studio rather than
 * a `WHERE` this file has to remember. Import writes under the *target* studio's
 * context, so the policies' `WITH CHECK` refuses any row whose `tenant_id` was
 * not rewritten — the archive cannot be used to write into a studio it did not
 * come from, even deliberately.
 */

/**
 * The tables that belong to a studio, in an order they can be written back in.
 *
 * `tenants` and `tenant_settings` are excluded for the same reason 0033 excludes
 * them: the first has no `tenant_id` and the second is read before any Tenant
 * context exists. The studio's identity and branding travel in the manifest and
 * in `tenant_settings` handled separately, not as ordinary rows.
 */
export async function tenantTableOrder() {
  const tables = (
    await db.execute<{ table_name: string }>(sql`
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND c.column_name = 'tenant_id'
        AND t.table_type = 'BASE TABLE'
        AND c.table_name <> 'tenant_settings'
      ORDER BY c.table_name
    `)
  ).map(r => r.table_name)

  const foreignKeys = (
    await db.execute<{ child: string; parent: string; column: string; required: boolean }>(sql`
      SELECT
        con.conrelid::regclass::text  AS child,
        con.confrelid::regclass::text AS parent,
        att.attname                   AS column,
        att.attnotnull                AS required
      FROM pg_constraint con
      JOIN LATERAL unnest(con.conkey) AS k(attnum) ON true
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
      WHERE con.contype = 'f'
        AND con.connamespace = 'public'::regnamespace
    `)
  ).map((r): ForeignKey => ({
    child: r.child,
    parent: r.parent,
    column: r.column,
    required: r.required,
  }))

  return orderTables(tables, foreignKeys)
}

/** Read one studio out of the database, whole. */
export async function exportTenant(tenantId: string): Promise<TenantArchive> {
  const tenant = await loadTenantById(tenantId)
  if (!tenant) throw new Error(`no such tenant: ${tenantId}`)

  const { order, deferred, unbreakable } = await tenantTableOrder()
  if (unbreakable.length > 0) {
    // Exporting would be fine; importing the result would not. Refusing here is
    // the honest place — an archive that cannot be restored is worse than none,
    // because it is only discovered on the day it is needed.
    throw new Error(
      `schema has an unbreakable foreign-key cycle, so an archive could not be restored: ${unbreakable
        .map(c => c.join(' -> '))
        .join('; ')}`,
    )
  }

  const rows: Record<string, Record<string, unknown>[]> = {}
  const counts: Record<string, number> = {}

  // One transaction and one snapshot, for every table and the settings alike.
  //
  // `repeatable read` is the whole of it, and it is not a detail. Under the
  // default `read committed` each statement takes a fresh snapshot, so a studio
  // that is *in use* while it is exported — which is every studio, since export
  // is offered precisely when something is about to change — yields an archive
  // whose bookings can reference a member read a moment before they existed.
  // Nothing detects that at export. It surfaces as a foreign-key violation on
  // the day the archive is restored, which is the worst day to find out.
  let settings: Record<string, unknown> | undefined
  await withTenant(
    tenantId,
    async () => {
      for (const table of order) {
        // No WHERE. Row-Level Security is the filter, and letting it be the
        // filter is the point: if a policy is ever wrong, the export is wrong in
        // the same direction as every other read, rather than being a second
        // opinion that hides the bug.
        const table_rows = await db.execute<Record<string, unknown>>(
          sql`SELECT * FROM ${sql.identifier(table)}`,
        )
        rows[table] = table_rows
        counts[table] = table_rows.length
      }

      // Branding, copy, mail identity and waiver text live outside Row-Level
      // Security, and the application role is fenced out of the last two by
      // column privilege — so `SELECT *` here is refused, correctly. Migration
      // 0038's SECURITY DEFINER reader is the door through that fence, and it
      // answers only for the Tenant whose context is open, which is why it runs
      // inside `withTenant` rather than beside it.
      ;[settings] = await db.execute<Record<string, unknown>>(
        sql`SELECT * FROM current_tenant_settings()`,
      )
    },
    { isolation: 'repeatable read' },
  )
  if (settings) {
    rows.tenant_settings = [settings]
    counts.tenant_settings = 1
  }

  return {
    manifest: {
      version: ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        timezone: tenant.timezone,
      },
      tables: settings ? [...order, 'tenant_settings'] : order,
      deferred,
      counts,
    },
    rows,
  }
}

export type ImportSummary = {
  /** Rows written, per table. */
  written: Record<string, number>
  /** Total rows written. */
  total: number
  /** The studio the archive came from, which is not the one it was written to. */
  sourceTenant: TenantManifest['tenant']
  /** True when the rows were given fresh ids because the source studio is still
   *  on this platform — a copy rather than a restore. */
  remapped: boolean
}

/**
 * Write a studio's archive into a Tenant.
 *
 * The target must be **empty**. Merging an archive into a studio that already
 * has rows is a different feature with different rules — which of two clients
 * with the same email wins, what happens to a booking whose class no longer
 * exists — and guessing at them would corrupt a live studio silently. Refusing
 * is the only safe default.
 *
 * **What a member holds is always restored exactly as it was.** Booking
 * references, QR tokens, invitation tokens: a booking's `code` is printed on a
 * member's confirmation and its `qr_token` is what they present at the door, so
 * an archive that changed them would hand back a studio whose members' bookings
 * no longer work. Migration 0040 is what makes that possible in both directions
 * — those keys are unique *within a Tenant*, so two studios may hold the same
 * ones.
 *
 * **Row ids are kept in exactly one case: restoring a studio into itself.** The
 * archive's manifest names the Tenant it came from, and when that is the Tenant
 * being written to, every id in it is provably free — the emptiness check below
 * has just established this studio holds no rows. Nothing else can be said that
 * cheaply, so nothing else is: every other import gives the rows fresh ids and
 * rewrites the references between them (`transfer-identity.ts`).
 *
 * That in-place restore is the disaster case the ids matter for. A studio's rows
 * are emptied and put back, and everything outside this database that named one
 * — a Stripe intent's metadata, a bookmarked admin URL — still resolves.
 *
 * An earlier version asked a cleverer question: are the archive's rows still in
 * the database? It was wrong in a way worth recording. On a database the source
 * studio was never on, the answer is "no" for the *second* import as much as the
 * first, so importing one archive into two studios took the preserve-ids branch
 * both times and collided row by row on the second. "Is the target the studio
 * this came from" cannot be wrong that way.
 *
 * What a member holds is unaffected either way — see above — so the cost of
 * renumbering is only to references held outside this database, and only a
 * studio being restored in place has any.
 */
export async function importTenant(
  targetTenantId: string,
  archive: TenantArchive,
): Promise<ImportSummary> {
  const target = await loadTenantById(targetTenantId)
  if (!target) throw new Error(`no such tenant: ${targetTenantId}`)

  if (archive.manifest.version !== ARCHIVE_VERSION) {
    throw new Error(
      `archive version ${archive.manifest.version} cannot be read by this server (expected ${ARCHIVE_VERSION})`,
    )
  }

  const { order, deferred } = await tenantTableOrder()
  const written: Record<string, number> = {}

  const rows = archive.rows
  const settings = rows.tenant_settings?.[0]
  const columnKinds = await columnKindsByTable()
  const plain: ColumnKinds = new Map()

  // Copy or restore? See the note on this function. Restoring in place is the
  // one case where the archive's ids are provably free, because the emptiness
  // check above has just established that this studio holds none of them.
  const inPlace = archive.manifest.tenant.id === targetTenantId
  const identity = inPlace ? new Map<string, string>() : buildIdentityMap(order, rows)

  await withTenant(targetTenantId, async () => {
    for (const table of order) {
      const [existing] = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`,
      )
      if ((existing?.n ?? 0) > 0) {
        throw new Error(
          `${target.slug} already has rows in ${table} — import only into an empty studio`,
        )
      }
    }

    // Pass one: every row, with the references no ordering can satisfy left
    // NULL so the insert is accepted.
    for (const table of order) {
      const tableRows = rows[table] ?? []
      if (tableRows.length === 0) {
        written[table] = 0
        continue
      }
      const hold = deferred[table] ?? []
      for (const row of tableRows) {
        // `tenant_id` last: it is set, never remapped, and the archive's own
        // value for it must not survive into another studio.
        const values: Record<string, unknown> = remapRow(row, identity)
        values.tenant_id = targetTenantId
        for (const column of hold) values[column] = null
        try {
          await insertRow(table, values, columnKinds.get(table) ?? plain)
        } catch (err) {
          throw duplicateExplained(err, table, archive.manifest.tenant.slug)
        }
      }
      written[table] = tableRows.length
    }

    // Pass two: fill in what pass one held back, now that every row it could
    // point at exists.
    for (const [table, columns] of Object.entries(deferred)) {
      for (const source of rows[table] ?? []) {
        const row = remapRow(source, identity)
        const fill = columns.filter(c => row[c] != null)
        if (fill.length === 0) continue
        // Pass two addresses a row by its id, so a deferred column on a table
        // keyed by its foreign keys instead — a join table — has nothing to
        // address. None exist today; say so rather than emit `WHERE id = NULL`
        // and silently fill nothing in.
        if (row.id == null) {
          throw new Error(
            `${table} has a deferred column (${columns.join(', ')}) but no id to fill it in by`,
          )
        }
        await db.execute(sql`
          UPDATE ${sql.identifier(table)}
          SET ${sql.join(
            fill.map(c => sql`${sql.identifier(c)} = ${row[c]}`),
            sql`, `,
          )}
          WHERE id = ${row.id}
        `)
      }
    }

    // Settings go back through migration 0038's writer for the same reason they
    // came out through its reader: the application role may not write the mail
    // identity or the waiver text directly, and the function takes its Tenant
    // from the open context rather than an argument — so an archive cannot
    // overwrite another studio's branding even deliberately.
    //
    // Inside the same transaction as the rows, and not after it. A settings
    // write that failed on its own would leave a studio holding all of its data
    // and none of its identity — no branding, no mail-from, no waiver — and the
    // import could not be run again to fix it, because the emptiness check above
    // now refuses a studio that has rows.
    if (settings) {
      await db.execute(sql`
        SELECT write_current_tenant_settings(
          ${settings.display_name ?? null},
          ${settings.logo_url ?? null},
          ${settings.favicon_url ?? null},
          ${settings.og_image_url ?? null},
          ${settings.tagline ?? null},
          ${asJsonb(settings.copy)}::jsonb,
          ${asJsonb(settings.theme)}::jsonb,
          ${settings.mail_from_name ?? null},
          ${settings.mail_from_email ?? null},
          ${settings.mail_reply_to ?? null},
          ${settings.waiver_text ?? null}
        )
      `)
      written.tenant_settings = 1
    }
  })

  return {
    written,
    total: Object.values(written).reduce((a, b) => a + b, 0),
    sourceTenant: archive.manifest.tenant,
    remapped: identity.size > 0,
  }
}

/**
 * Say what a duplicate key here actually means.
 *
 * This should now be unreachable for the case it was written for. Copying a
 * studio beside itself used to break on the first platform-wide unique key it
 * met; migration 0040 scoped those to the Tenant and `transfer-identity.ts`
 * gives the copy fresh row ids, so the two studios collide over nothing.
 *
 * It is kept because a raw `duplicate key value violates unique constraint …`
 * is a dead end for the operator, and a unique key added later without either of
 * those two properties would land here. Naming both the table and the studio is
 * what makes the report actionable.
 */
function duplicateExplained(err: unknown, table: string, sourceSlug: string): Error {
  // Through the repo's own helper, which walks the cause chain: Drizzle wraps
  // the driver error, but not always, and reading `err.cause.code` alone lets an
  // unwrapped `23505` past — handing the operator the raw constraint message
  // this function exists to replace.
  if (!isUniqueViolation(err)) return err instanceof Error ? err : new Error(String(err))
  return new Error(
    `${table} refused a row from this archive as a duplicate. The archive came from ${sourceSlug}, ` +
      `which still holds rows this studio may not have alongside it — a unique key on ${table} is ` +
      `platform-wide rather than per-Tenant. Delete ${sourceSlug} first, or import into a database ` +
      `that does not have it.`,
  )
}

/**
 * A `jsonb` argument, as text Postgres will cast.
 *
 * The driver hands `jsonb` back already parsed, and hands a plain object *in* as
 * an error — it has no way to know a bare object was meant to be JSON rather
 * than a composite type. Round-tripping it through text is the way to say so.
 */
function asJsonb(value: unknown): string | null {
  if (value == null) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * One row, written by column name.
 *
 * Identifiers come from the catalogue and the values are parameters, so the
 * archive's *content* never reaches the query as text — a studio whose class is
 * called `'); drop table clients; --` restores like any other.
 */
async function insertRow(
  table: string,
  row: Record<string, unknown>,
  kinds: ColumnKinds,
) {
  const columns = Object.keys(row)
  await db.execute(sql`
    INSERT INTO ${sql.identifier(table)} (${sql.join(
      columns.map(c => sql.identifier(c)),
      sql`, `,
    )})
    VALUES (${sql.join(
      columns.map(c => literal(row[c], kinds.get(c))),
      sql`, `,
    )})
  `)
}

/**
 * One value, in the form its column will take it.
 *
 * Two column shapes need saying explicitly, and both are read from the
 * catalogue rather than guessed from the value:
 *
 *  - **`json`/`jsonb`.** The driver hands one back already parsed and refuses to
 *    take a plain object in, because it cannot tell JSON from a composite type.
 *  - **Arrays.** The `sql` template renders an array parameter as a value list —
 *    `(a, b)`, which is an `IN` clause and not an array — and an *empty* one as
 *    `()`, which is not valid SQL at all. `staff_users.granted_location_ids` is
 *    empty on most rows, so this is the common path rather than an edge.
 *
 * Guessing from the value would get both wrong in the same direction: a JSON
 * array would be sent as a Postgres array, and would restore as the wrong type.
 */
function literal(value: unknown, kind: ColumnKind | undefined) {
  if (kind?.type === 'json') return sql`${asJsonb(value)}::jsonb`
  if (kind?.type === 'array') {
    if (value == null) return sql`${null}`
    const items = Array.isArray(value) ? value : [value]
    return sql`${pgArray(items)}::${sql.raw(kind.element)}[]`
  }
  return sql`${value}`
}

/** `{"a","b"}` — Postgres's own array literal, quoted so a comma is safe. */
function pgArray(items: readonly unknown[]): string {
  const parts = items.map(item => {
    if (item == null) return 'NULL'
    return `"${String(item).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  })
  return `{${parts.join(',')}}`
}

type ColumnKind = { type: 'json' } | { type: 'array'; element: string }
type ColumnKinds = ReadonlyMap<string, ColumnKind>

/** The columns that need a cast, per table, read once per import. */
async function columnKindsByTable(): Promise<Map<string, Map<string, ColumnKind>>> {
  const rows = await db.execute<{
    table_name: string
    column_name: string
    data_type: string
    udt_name: string
  }>(sql`
    SELECT table_name, column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (data_type IN ('json', 'jsonb') OR data_type = 'ARRAY')
  `)

  const map = new Map<string, Map<string, ColumnKind>>()
  for (const r of rows) {
    const columns = map.get(r.table_name) ?? new Map<string, ColumnKind>()
    columns.set(
      r.column_name,
      r.data_type === 'ARRAY'
        ? // `udt_name` for a `uuid[]` column is `_uuid`.
          { type: 'array', element: r.udt_name.replace(/^_/, '') }
        : { type: 'json' },
    )
    map.set(r.table_name, columns)
  }
  return map
}
