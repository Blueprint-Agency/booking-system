import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { asc, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const MIGRATION = path.resolve(process.cwd(), 'src/db/migrations/0143_entities_all_classes.sql')

/**
 * Migration 0143: every studio that exists when it runs and has no Entity is
 * given one, "All classes". A studio created before Entities is in exactly that
 * state, so two throwaway studios stand in for it: one with no Entity, and one
 * that already has its own, renamed. The migration's own SQL is run against
 * them, twice, as the owner, as the migrator runs it.
 */
describe('migration 0143: every studio has an "All classes" Entity', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  const studios: Array<{ id: string; slug: string }> = []

  async function migrate() {
    for (const statement of readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint')) {
      await harness.db.execute(sql.raw(statement))
    }
  }

  const entitiesOf = (tenantId: string) =>
    harness.db
      .select({ name: schema.entities.name, slug: schema.entities.slug, position: schema.entities.position, archivedAt: schema.entities.archivedAt })
      .from(schema.entities)
      .where(eq(schema.entities.tenantId, tenantId))
      .orderBy(asc(schema.entities.position))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
  })

  after(async () => {
    if (!harness) return
    try {
      const { setTenantStatus } = await import('../services/tenants/tenants')
      const { deleteTenant } = await import('../services/tenants/delete')
      for (const studio of studios) {
        await setTenantStatus(studio.id, 'suspended')
        await deleteTenant({ tenantId: studio.id, confirmSlug: studio.slug })
      }
    } finally {
      await harness.close()
    }
  })

  test('SCH-63 a studio with no Entity gets one "All classes", a studio with its own keeps only that, and running it again changes nothing', async () => {
    const { provisionTenant } = await import('../services/tenants/provision')
    // No first admin: the studio is created empty, the state a studio from before Entities is in.
    const bare = (await provisionTenant({ slug: `entm-bare-${run}`, name: 'Entities bare' })).tenant
    const owned = (await provisionTenant({ slug: `entm-owned-${run}`, name: 'Entities owned' })).tenant
    studios.push({ id: bare.id, slug: bare.slug }, { id: owned.id, slug: owned.slug })
    await harness.db.insert(schema.entities).values({ tenantId: owned.id, name: 'Yoga', slug: 'yoga', position: 0 })

    assert.deepEqual(await entitiesOf(bare.id), [], 'created empty, as an archive target is')

    await migrate()
    assert.deepEqual(await entitiesOf(bare.id), [{ name: 'All classes', slug: 'all-classes', position: 0, archivedAt: null }])
    assert.deepEqual(await entitiesOf(owned.id), [{ name: 'Yoga', slug: 'yoga', position: 0, archivedAt: null }])

    await migrate()
    assert.equal((await entitiesOf(bare.id)).length, 1)
    assert.equal((await entitiesOf(owned.id)).length, 1)

    // Every studio on the platform now has at least one, the fixtures included.
    const without = await harness.db.execute<{ slug: string }>(
      sql`SELECT t.slug FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM entities e WHERE e.tenant_id = t.id)`,
    )
    assert.deepEqual([...without], [])
  })
})
