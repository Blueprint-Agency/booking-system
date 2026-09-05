import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { packArchive, unpackArchive } from '../services/tenants/transfer-archive'
import { ARCHIVE_VERSION, ArchiveError } from '../services/tenants/transfer-shape'

/**
 * A studio comes out whole and goes back whole.
 *
 * The property that matters is not "export returns rows" — it is that a studio
 * exported, then restored into a *different, empty* Tenant, is the same studio.
 * Same members, same classes, same references between them. A test that only
 * counted rows would pass while every foreign key pointed at nothing.
 *
 * Two Tenants are essential here for the same reason they are everywhere else in
 * this suite: exporting with only one studio's data present cannot show that the
 * export is scoped, because there is nothing else it could have picked up.
 */

let harness: TestApp
let transfer: typeof import('../services/tenants/transfer')

before(async () => {
  if (!integrationTestsEnabled) return
  harness = await startTestApp()
  transfer = await import('../services/tenants/transfer')
})

after(async () => {
  await harness?.close()
})

const options = { skip: integrationTestsEnabled ? false : SKIP_REASON }

/** A third, empty Tenant to restore into — never one of the fixture pair. */
async function emptyTenant(slug: string) {
  const [row] = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO tenants (slug, name, timezone, status)
    VALUES (${slug}, ${`Restored ${slug}`}, 'Asia/Singapore', 'active')
    RETURNING id
  `)
  return row!.id
}

/**
 * A studio of this test's own, with enough in it to be worth restoring.
 *
 * Deliberately includes the two things a row count cannot check: a member who
 * refers another (the self-reference the two-pass write exists for) and a waiver
 * text (a `tenant_settings` column the application role may not read directly).
 */
async function studioWithData(slug: string): Promise<string> {
  const tenantId = await emptyTenant(slug)

  const [referrer] = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO clients (tenant_id, clerk_user_id, email, name, phone)
    VALUES (${tenantId}, ${`clerk_${slug}_member`}, 'member@restored.test', 'Restored Member', '+6580000001')
    RETURNING id
  `)
  await harness.db.execute(sql`
    INSERT INTO clients (tenant_id, clerk_user_id, email, name, phone, referred_by_client_id)
    VALUES (${tenantId}, ${`clerk_${slug}_friend`}, 'friend@restored.test', 'Referred Friend', '+6580000002', ${referrer!.id})
  `)
  await harness.db.execute(sql`
    INSERT INTO locations (tenant_id, name) VALUES (${tenantId}, 'The Studio')
  `)
  await harness.db.execute(sql`
    INSERT INTO tenant_settings (tenant_id, display_name, waiver_text)
    VALUES (${tenantId}, ${slug}, ${'The studio’s own words.'})
  `)

  return tenantId
}

/**
 * Empty a studio, the way deleting one would.
 *
 * Children before parents — the reverse of the write order — because the
 * foreign keys that make a restore need an order make a delete need one too.
 */
async function deleteTenantRows(tenantId: string) {
  const { order } = await transfer.tenantTableOrder()
  for (const table of [...order].reverse()) {
    await harness.db.execute(
      sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`,
    )
  }
}

test('the table list is discovered, not written down', options, async () => {
  const { order, unbreakable } = await transfer.tenantTableOrder()

  assert.equal(unbreakable.length, 0, 'the schema must be restorable in some order')
  assert.ok(order.length > 40, `expected the whole schema, got ${order.length} tables`)
  assert.ok(order.includes('clients'), 'members are part of a studio')
  assert.ok(order.includes('bookings'), 'bookings are part of a studio')
  assert.ok(!order.includes('tenants'), 'the directory is not a studio row')
  assert.ok(!order.includes('tenant_settings'), 'settings are handled outside RLS')

  // Parents first, or the restore would be refused by the first foreign key.
  assert.ok(
    order.indexOf('clients') < order.indexOf('bookings'),
    'a booking cannot be written before the member who made it',
  )
})

test('a self-reference is deferred rather than ordered', options, async () => {
  const { deferred } = await transfer.tenantTableOrder()
  // No ordering of tables can satisfy a column that points into its own table.
  assert.deepEqual(deferred.clients, ['referred_by_client_id'])
  assert.deepEqual(deferred.class_types, ['parent_id'])
})

test('an export carries one studio and not the other', options, async () => {
  const mine = await transfer.exportTenant(harness.tenants.one.id)

  assert.equal(mine.manifest.tenant.slug, harness.tenants.one.slug)
  assert.equal(mine.manifest.version, ARCHIVE_VERSION)

  // Every row in the archive belongs to the studio it names. This is the whole
  // claim of the feature — one missed `tenant_id` and an operator hands a studio
  // a file containing someone else's members.
  for (const [table, rows] of Object.entries(mine.rows)) {
    for (const row of rows) {
      assert.equal(
        row.tenant_id,
        harness.tenants.one.id,
        `${table} carries a row belonging to another studio`,
      )
    }
  }

  const theirs = await transfer.exportTenant(harness.tenants.two.id)
  assert.notEqual(
    JSON.stringify(mine.rows.locations),
    JSON.stringify(theirs.rows.locations),
    'two studios must not export the same premises',
  )
})

test('a studio emptied and restored in place is the same studio, ids included', options, async () => {
  // The flow the feature exists for: take the studio out, lose its rows, put
  // them back where they were.
  //
  // On a studio of its own, never one of the fixture pair. Emptying a fixture
  // would empty the studios every other test in this suite compares against,
  // and the failures would land somewhere else entirely.
  const source = await studioWithData(`source-${Date.now()}`)
  const archive = await transfer.exportTenant(source)
  await deleteTenantRows(source)

  // Back into the studio it came from. That is the one case where the archive's
  // ids are provably free — this studio holds none of them — and therefore the
  // one case that keeps them.
  const target = source
  const summary = await transfer.importTenant(target, archive)
  assert.equal(summary.sourceTenant.slug, archive.manifest.tenant.slug)
  assert.ok(summary.total > 0, 'a studio with data must restore some rows')

  // Every row goes back under the id it had, because things outside this
  // database — a Stripe intent's metadata, a bookmarked admin URL — still name
  // it.
  assert.equal(summary.remapped, false, 'a restore in place must not renumber the studio')
  const restored = await harness.db.execute<{ id: string }>(
    sql`SELECT id FROM clients WHERE tenant_id = ${target}`,
  )
  assert.deepEqual(
    restored.map(r => r.id).sort(),
    archive.rows.clients!.map(r => String(r.id)).sort(),
  )

  // Row for row, table for table.
  for (const [table, count] of Object.entries(archive.manifest.counts)) {
    const [row] = await harness.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE tenant_id = ${target}
    `)
    assert.equal(row?.n, count, `${table} restored ${row?.n} of ${count} rows`)
  }

  // The values came back, not just the shape.
  const [client] = await harness.db.execute<{ email: string; name: string }>(sql`
    SELECT email, name FROM clients WHERE tenant_id = ${target}
  `)
  assert.equal(client?.email, 'member@restored.test')
  assert.equal(client?.name, 'Restored Member')

  // The self-reference the two-pass write exists for: the second member was
  // referred by the first, and no ordering of tables could have made that work.
  const [referral] = await harness.db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM clients child
    JOIN clients parent ON parent.id = child.referred_by_client_id
    WHERE child.tenant_id = ${target}
  `)
  assert.equal(referral?.n, 1, 'a restored referral points at the member who made it')

  // And the settings the app role cannot read directly came through too.
  const [settings] = await harness.db.execute<{ waiver_text: string }>(sql`
    SELECT waiver_text FROM tenant_settings WHERE tenant_id = ${target}
  `)
  assert.equal(settings?.waiver_text, 'The studio’s own words.')
})

test('a studio that already has rows refuses the import', options, async () => {
  const source = await transfer.exportTenant(harness.tenants.one.id)
  // Tenant one is not empty — it is the studio the archive came from. Merging is
  // a different feature with rules nobody has decided, so this must refuse
  // rather than guess which of two rows wins.
  await assert.rejects(
    () => transfer.importTenant(harness.tenants.one.id, source),
    /already has rows/,
    'importing over a live studio must be refused',
  )
})

test('a studio copies into a second one beside it', options, async () => {
  // The ordinary operator flow: export studio A, create studio B, import into
  // B — with A still on the platform the whole time. It used to break on the
  // first platform-wide unique key it met.
  const source = await studioWithData(`copysrc-${Date.now()}`)
  const archive = await transfer.exportTenant(source)

  const target = await emptyTenant(`copydst-${Date.now()}`)
  const summary = await transfer.importTenant(target, archive)

  assert.equal(summary.remapped, true, 'a copy beside the original must get fresh ids')

  for (const [table, count] of Object.entries(archive.manifest.counts)) {
    const [row] = await harness.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE tenant_id = ${target}
    `)
    assert.equal(row?.n, count, `${table} copied ${row?.n} of ${count} rows`)
  }

  // Fresh ids, and the original untouched — the two studios share no row.
  const copied = await harness.db.execute<{ id: string }>(
    sql`SELECT id FROM clients WHERE tenant_id = ${target}`,
  )
  const originals = new Set(archive.rows.clients!.map(r => String(r.id)))
  assert.equal(copied.length, originals.size)
  for (const row of copied) {
    assert.ok(!originals.has(row.id), 'a copied row must not reuse the original row s id')
  }

  // Rewritten consistently: the referral still points at the member who made
  // it, and at the *copy* of them rather than the original.
  const [referral] = await harness.db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM clients child
    JOIN clients parent ON parent.id = child.referred_by_client_id
    WHERE child.tenant_id = ${target} AND parent.tenant_id = ${target}
  `)
  assert.equal(referral?.n, 1, 'a copied referral points at the copied member')

  // The original is still whole. A copy must take nothing from what it copied.
  const [before] = await harness.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM clients WHERE tenant_id = ${source}`,
  )
  assert.equal(before?.n, originals.size)
})

test('one archive restores into two studios, even with the source gone', options, async () => {
  // The case that broke the cleverer rule this replaced. Asking "are the
  // archive's rows still in the database" answers no for the *second* import as
  // much as the first when the source studio was never on this database — so
  // both took the keep-the-ids branch and the second collided row by row.
  const source = await studioWithData(`twice-src-${Date.now()}`)
  const archive = await transfer.exportTenant(source)
  await deleteTenantRows(source)

  const first = await emptyTenant(`twice-a-${Date.now()}`)
  const second = await emptyTenant(`twice-b-${Date.now()}`)

  const one = await transfer.importTenant(first, archive)
  const two = await transfer.importTenant(second, archive)

  assert.equal(one.remapped, true, 'neither target is the studio it came from')
  assert.equal(two.remapped, true)
  assert.equal(one.total, two.total, 'both studios got the whole archive')

  // Two studios, the same archive, no row shared between them.
  const a = await harness.db.execute<{ id: string }>(
    sql`SELECT id FROM clients WHERE tenant_id = ${first}`,
  )
  const b = await harness.db.execute<{ id: string }>(
    sql`SELECT id FROM clients WHERE tenant_id = ${second}`,
  )
  assert.ok(a.length > 0)
  assert.equal(a.length, b.length)
  const ids = new Set(a.map(r => r.id))
  for (const row of b) assert.ok(!ids.has(row.id), 'the two copies must not share a row id')
})

test('a studio restored from an archive gets its branding too', options, async () => {
  // The settings write is in the same transaction as the rows. Left outside it,
  // a failure there would leave a studio holding all of its data and none of its
  // identity — and the emptiness check would then refuse the retry.
  const source = await studioWithData(`branded-${Date.now()}`)
  const archive = await transfer.exportTenant(source)

  const target = await emptyTenant(`branded-dst-${Date.now()}`)
  const summary = await transfer.importTenant(target, archive)
  assert.equal(summary.written.tenant_settings, 1)

  const [settings] = await harness.db.execute<{ waiver_text: string }>(
    sql`SELECT waiver_text FROM tenant_settings WHERE tenant_id = ${target}`,
  )
  assert.equal(settings?.waiver_text, 'The studio’s own words.')
})

test('the archive survives a round trip through a zip', options, async () => {
  const source = await transfer.exportTenant(harness.tenants.one.id)
  const bytes = await packArchive(source)
  const read = await unpackArchive(bytes)

  assert.deepEqual(read.manifest, source.manifest)
  assert.deepEqual(
    Object.keys(read.rows).sort(),
    Object.keys(source.rows).sort(),
    'every table in the manifest is in the zip',
  )
  assert.deepEqual(
    read.rows.locations?.map(r => r.name),
    source.rows.locations?.map(r => r.name),
  )
})

test('a zip missing rows is refused, not half-restored', options, async () => {
  const source = await transfer.exportTenant(harness.tenants.one.id)
  // A truncated archive still opens as a zip. The manifest's count is the only
  // thing that knows it is short.
  const truncated = { ...source, rows: { ...source.rows, locations: [] } }
  const bytes = await packArchive(truncated)

  await assert.rejects(() => unpackArchive(bytes), ArchiveError)
})

test('something that is not a studio export is refused by name', options, async () => {
  await assert.rejects(
    () => unpackArchive(Buffer.from('this is not a zip')),
    (err: Error) => err instanceof ArchiveError && /not a zip/.test(err.message),
  )
})
