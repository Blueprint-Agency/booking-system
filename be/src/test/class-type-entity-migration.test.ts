import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const MIGRATION = path.resolve(process.cwd(), 'src/db/migrations/0145_class_types_entity_backfill.sql')

/**
 * Migration 0145: every Class Type that exists when it runs and has no Entity is
 * put in its studio's first live Entity. A Class Type from before Entities is in
 * exactly that state (the column is nullable), so rows are made with none, and
 * the migration's own SQL is run against them, twice, as the owner, as the
 * migrator runs it.
 */
describe('migration 0145: every Class Type is in an Entity', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  const studios: Array<{ id: string; slug: string }> = []

  async function migrate() {
    for (const statement of readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint')) {
      await harness.db.execute(sql.raw(statement))
    }
  }

  const entityOf = async (id: string) =>
    (await harness.db.select({ entityId: schema.classTypes.entityId }).from(schema.classTypes).where(eq(schema.classTypes.id, id)))[0]!.entityId

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
        await harness.db.delete(schema.classTypes).where(eq(schema.classTypes.tenantId, studio.id))
        await setTenantStatus(studio.id, 'suspended')
        await deleteTenant({ tenantId: studio.id, confirmSlug: studio.slug })
      }
    } finally {
      await harness.close()
    }
  })

  test('SCH-76 each Class Type with no Entity, sub-types and archived ones too, goes to its studio’s first live Entity; one with an Entity, and a studio with none, are left, and a second run changes nothing', async () => {
    const { provisionTenant } = await import('../services/tenants/provision')
    // No first admin: created with no Entity, the state a studio from before Entities is in.
    const full = (await provisionTenant({ slug: `ctem-full-${run}`, name: 'Class type entity full' })).tenant
    const bare = (await provisionTenant({ slug: `ctem-bare-${run}`, name: 'Class type entity bare' })).tenant
    studios.push({ id: full.id, slug: full.slug }, { id: bare.id, slug: bare.slug })

    // The first live Entity is "Yoga" (an archived "Old" precedes it by position, "Barre" follows).
    const [old, yoga, barre] = await harness.db
      .insert(schema.entities)
      .values([
        { tenantId: full.id, name: 'Old', slug: 'old', position: 0, archivedAt: new Date() },
        { tenantId: full.id, name: 'Yoga', slug: 'yoga', position: 1 },
        { tenantId: full.id, name: 'Barre', slug: 'barre', position: 2 },
      ])
      .returning({ id: schema.entities.id })
    assert.ok(old && yoga && barre)

    const make = async (tenantId: string, name: string, over: Record<string, unknown> = {}) =>
      (await harness.db.insert(schema.classTypes).values({ tenantId, name, ...over }).returning({ id: schema.classTypes.id }))[0]!.id
    const root = await make(full.id, 'Root')
    const sub = await make(full.id, 'Sub', { parentId: root })
    const archived = await make(full.id, 'Archived', { archivedAt: new Date() })
    const deleted = await make(full.id, 'Deleted', { archivedAt: new Date(), deletedAt: new Date() })
    const taken = await make(full.id, 'Taken', { entityId: barre.id })
    const orphan = await make(bare.id, 'No Entity here')

    await migrate()
    assert.deepEqual(
      await Promise.all([root, sub, archived, deleted, taken].map(entityOf)),
      [yoga.id, yoga.id, yoga.id, yoga.id, barre.id],
    )
    assert.equal(await entityOf(orphan), null, 'a studio with no Entity has nothing to give')

    await migrate()
    assert.deepEqual(
      await Promise.all([root, sub, archived, deleted, taken].map(entityOf)),
      [yoga.id, yoga.id, yoga.id, yoga.id, barre.id],
    )
  })
})
