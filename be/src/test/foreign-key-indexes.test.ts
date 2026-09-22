import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

/**
 * Every foreign key has an index that starts with its column.
 *
 * Postgres checks a foreign key from both ends. Inserting a child looks up the
 * parent by its primary key, which is always indexed. Deleting a parent looks
 * up the children — `SELECT 1 FROM child WHERE fk_column = $1`, once per
 * deleted row — and nothing indexes that side unless someone does. Without it,
 * each lookup reads the whole child table.
 *
 * The indexes this schema already had lead with `tenant_id`, for the queries a
 * studio runs; they cannot answer a lookup by the foreign key column alone.
 * Deleting a studio deletes every row of its in a handful of statements, so it
 * is where a missing one shows first: a studio restored with years of history
 * took ~40s to delete, past the portal's request deadline (#194). The same
 * lookup runs when a single client or class is deleted, only smaller.
 *
 * Read from the catalogue, so a foreign key added later is held to it too.
 */
describe('foreign key indexes', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp

  before(async () => {
    harness = await startTestApp()
  })

  after(async () => {
    await harness?.close()
  })

  test('every foreign key column leads an index on its table', async () => {
    const missing = await harness.db.execute<{ fk: string }>(sql`
      SELECT con.conrelid::regclass::text || '(' || string_agg(a.attname, ', ' ORDER BY k.ord) || ')' AS fk
      FROM pg_constraint con
      JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
      WHERE con.contype = 'f'
        AND con.connamespace = 'public'::regnamespace
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = con.conrelid
            -- The index's leading columns are the foreign key's, in any order.
            AND (i.indkey::int2[])[0:array_length(con.conkey, 1) - 1] @> con.conkey
            AND (i.indkey::int2[])[0:array_length(con.conkey, 1) - 1] <@ con.conkey
        )
      GROUP BY con.oid, con.conrelid
      ORDER BY 1
    `)
    assert.deepEqual(
      missing.map(r => r.fk),
      [],
      'index each of these in its schema file — a delete of the table it points at scans the whole table per row without one',
    )
  })
})
