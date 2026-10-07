import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { memberFixtures } from './member-fixtures'

/**
 * `memberFixtures().cleanup` is what every file that builds on the fixtures
 * runs in `after`. When it stopped at the first row it could not delete, every
 * row after that one survived into the next file, and one stuck row turned into
 * failures in tests that had nothing to do with it (#260).
 */
describe('member fixtures cleanup', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let tenantId!: string

  const DOMAIN = `member-fixtures-${Date.now().toString(36)}.test`

  const exists = async (table: string, id: unknown) =>
    (await harness.db.execute(sql`SELECT 1 FROM ${sql.identifier(table)} WHERE id = ${id}`)).length > 0

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    tenantId = harness.tenants.one.id
  })

  after(async () => {
    await harness?.close()
  })

  test('a row a test hung off a fixture goes with the fixture', async () => {
    const fixtures = memberFixtures(harness, schema, DOMAIN)
    const other = memberFixtures(harness, schema, `other-${DOMAIN}`)
    try {
      const cls = await fixtures.insertRow('classes', tenantId)
      // Made outside `fixtures`, the way a test bulk-inserts bookings onto a fixture class.
      const booking = await other.insertRow('bookings', tenantId, { class_id: cls.id })

      await fixtures.cleanup()

      assert.equal(await exists('classes', cls.id), false)
      assert.equal(await exists('bookings', booking.id), false)
    } finally {
      await other.cleanup()
    }
  })

  test('a row it cannot delete is reported at the end, and every other row still goes', async () => {
    const fixtures = memberFixtures(harness, schema, DOMAIN)
    // Made first, so it is deleted after the stuck class.
    const pkg = await fixtures.insertRow('class_packages', tenantId)
    const cls = await fixtures.insertRow('classes', tenantId)

    // A row nothing may delete, pointing at the class: the class cannot go either.
    await harness.db.execute(sql`
      CREATE TABLE fixture_cleanup_probe (id serial PRIMARY KEY, class_id uuid NOT NULL REFERENCES classes(id))`)
    try {
      await harness.db.execute(sql`
        CREATE FUNCTION fixture_cleanup_probe_refuse() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'fixture_cleanup_probe rows stay'; END $$`)
      await harness.db.execute(sql`
        CREATE TRIGGER refuse_delete BEFORE DELETE ON fixture_cleanup_probe
        FOR EACH ROW EXECUTE FUNCTION fixture_cleanup_probe_refuse()`)
      await harness.db.execute(sql`INSERT INTO fixture_cleanup_probe (class_id) VALUES (${cls.id})`)

      await assert.rejects(fixtures.cleanup(), (err: Error) => {
        assert.match(err.message, /cleanup left rows behind/)
        assert.match(err.message, /^classes: /m)
        return true
      })

      assert.equal(await exists('classes', cls.id), true)
      assert.equal(await exists('class_packages', pkg.id), false)
    } finally {
      await harness.db.execute(sql`DROP TABLE IF EXISTS fixture_cleanup_probe`)
      await harness.db.execute(sql`DROP FUNCTION IF EXISTS fixture_cleanup_probe_refuse()`)
      await harness.db.execute(sql`DELETE FROM classes WHERE id = ${cls.id}`)
    }
  })
})
