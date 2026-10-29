import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const MIGRATION = path.resolve(process.cwd(), 'src/db/migrations/0115_business_name.sql')

/**
 * Migration 0115: a studio's Business name replaces the Receipt's Legal
 * name. A studio that set a Legal name trades under it; one that did not keeps
 * the name it already has; and a settings row written without a Business name
 * (a restore) takes the display name, else the Domain name.
 *
 * Throwaway studios, provisioned today. One is given a Legal name back, as a
 * studio migrated from before would carry, and the migration's own SQL is run
 * against them, twice.
 */
describe('migration 0115: the Legal name becomes the Business name', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  const studios: Array<{ id: string; slug: string; name: string }> = []

  /** The migration as the migrator runs it: statement by statement, as the owner. */
  async function migrate() {
    for (const statement of readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint')) {
      await harness.db.execute(sql.raw(statement))
    }
  }

  async function businessName(tenantId: string): Promise<string | undefined> {
    const [row] = await harness.db.execute<{ business_name: string }>(
      sql`SELECT business_name FROM tenant_settings WHERE tenant_id = ${tenantId}`,
    )
    return row?.business_name
  }

  before(async () => {
    harness = await startTestApp()
    const provision = await import('../services/tenants/provision')
    for (const slug of [`bn-legal-${run}`, `bn-none-${run}`, `bn-restored-${run}`]) {
      const name = `Business Name ${slug}`
      const { tenant } = await provision.provisionTenant({ slug, name })
      studios.push({ id: tenant.id, slug, name })
    }
  })

  after(async () => {
    if (!harness) return
    try {
      const { deleteTenant } = await import('../services/tenants/delete')
      for (const { id, slug } of studios) {
        await harness.db.execute(sql`UPDATE tenants SET status = 'suspended' WHERE id = ${id}`)
        await deleteTenant({ tenantId: id, confirmSlug: slug })
      }
    } finally {
      await harness.close()
    }
  })

  test('TEN-38 a studio’s Legal name becomes its Business name, one without keeps the name it has, the Legal name is gone, and a second run changes nothing', async () => {
    const [legal, none] = [studios[0]!, studios[1]!]
    assert.equal(await businessName(none.id), none.name, 'provisioned under its Domain name')

    // The column as a studio migrated from before the Business name carries it.
    await harness.db.execute(sql`ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS receipt_legal_name text`)
    await harness.db.execute(
      sql`UPDATE tenant_settings SET receipt_legal_name = ${`  Legal ${run} Pte. Ltd. `} WHERE tenant_id = ${legal.id}`,
    )

    await migrate()

    assert.equal(await businessName(legal.id), `Legal ${run} Pte. Ltd.`, 'the Legal name, trimmed')
    assert.equal(await businessName(none.id), none.name, 'no Legal name: the name it had')
    const [column] = await harness.db.execute(sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tenant_settings' AND column_name = 'receipt_legal_name'`)
    assert.equal(column, undefined, 'the Legal name column is gone')

    await migrate()
    assert.equal(await businessName(legal.id), `Legal ${run} Pte. Ltd.`, 'a second run changes nothing')
    assert.equal(await businessName(none.id), none.name)
  })

  test('TEN-38 a settings row written without a Business name takes the display name, else the Domain name', async () => {
    const restored = studios[2]!
    const rewrite = async (insert: ReturnType<typeof sql>) => {
      await harness.db.execute(sql`DELETE FROM tenant_settings WHERE tenant_id = ${restored.id}`)
      await harness.db.execute(insert)
      return businessName(restored.id)
    }

    assert.equal(
      await rewrite(sql`INSERT INTO tenant_settings (tenant_id, display_name) VALUES (${restored.id}, ${`Shown As ${run}`})`),
      `Shown As ${run}`,
    )
    assert.equal(
      await rewrite(sql`INSERT INTO tenant_settings (tenant_id, display_name) VALUES (${restored.id}, '  ')`),
      restored.name,
      'no display name: the Domain name',
    )
    assert.equal(
      await rewrite(sql`INSERT INTO tenant_settings (tenant_id, business_name) VALUES (${restored.id}, ${`Named ${run}`})`),
      `Named ${run}`,
      'a Business name given is the one kept',
    )
  })
})
