import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const MIGRATION = path.resolve(process.cwd(), 'src/db/migrations/0147_package_entity_backfill.sql')

/**
 * Migration 0147: every catalogue package that exists when it runs and names no
 * Entity goes into its studio's first live Entity. A package made before
 * Entities is in exactly that state (the columns are new, so null), so throwaway
 * studios stand in: one whose first Entity is "All classes", one whose first
 * Entity is archived, and a package that already names its own. The migration's
 * own SQL is run against them, twice, as the owner, as the migrator runs it.
 */
describe('migration 0147: every package is in its studio\'s first Entity', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  const studios: Array<{ id: string; slug: string }> = []

  async function migrate() {
    for (const statement of readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint')) {
      await harness.db.execute(sql.raw(statement))
    }
  }

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

  /** A studio with the Entities given, in order, `null` marking none archived, and one package of each kind with no Entity. */
  async function studio(label: string, entityList: Array<{ name: string; archived?: boolean }>) {
    const { provisionTenant } = await import('../services/tenants/provision')
    const tenant = (await provisionTenant({ slug: `pkgm-${label}-${run}`, name: `Package migration ${label}` })).tenant
    studios.push({ id: tenant.id, slug: tenant.slug })
    const made = await harness.db
      .insert(schema.entities)
      .values(
        entityList.map((entity, position) => ({
          tenantId: tenant.id,
          name: entity.name,
          slug: entity.name.toLowerCase(),
          position,
          archivedAt: entity.archived ? new Date() : null,
        })),
      )
      .returning()
    const [staff] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email: `staff-${label}-${run}@${run}.package-migration.test`, name: 'Staff', role: 'admin', status: 'active', authUserId: randomUUID() })
      .returning()
    const [bundle, archived] = await harness.db
      .insert(schema.classPackages)
      .values([
        { tenantId: tenant.id, name: 'Bundle', kind: 'credit_bundle', credits: 5, validityDays: 30, priceSgd: '50.00' },
        { tenantId: tenant.id, name: 'Old plan', kind: 'unlimited', durationMonths: 3, priceSgd: '300.00', status: 'archived', archivedAt: new Date() },
      ])
      .returning()
    const [pt] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: tenant.id, name: 'PT', sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '400.00' })
      .returning()
    const [corporate] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: tenant.id, name: 'Corporate', priceSgd: '900.00', createdByStaffId: staff!.id })
      .returning()
    return { tenant, entities: made, bundle: bundle!, archived: archived!, pt: pt!, corporate: corporate! }
  }

  async function entityIds(s: Awaited<ReturnType<typeof studio>>) {
    const read = async (table: typeof schema.classPackages | typeof schema.ptPackages | typeof schema.corporatePackages, id: string) => {
      const [row] = await harness.db.select({ entityId: table.entityId }).from(table).where(eq(table.id, id))
      return row!.entityId
    }
    return {
      bundle: await read(schema.classPackages, s.bundle.id),
      archived: await read(schema.classPackages, s.archived.id),
      pt: await read(schema.ptPackages, s.pt.id),
      corporate: await read(schema.corporatePackages, s.corporate.id),
    }
  }

  test('PKG-77 every package with no Entity goes in its studio\'s first live Entity, one that names its own is left, and running it again changes nothing', async () => {
    const plain = await studio('plain', [{ name: 'Yoga' }, { name: 'Pilates' }])
    const skipped = await studio('skipped', [{ name: 'Barre', archived: true }, { name: 'Reformer' }, { name: 'Mat' }])
    const chosen = await studio('chosen', [{ name: 'Yoga' }, { name: 'Pilates' }])
    await harness.db.update(schema.classPackages).set({ entityId: chosen.entities[1]!.id }).where(eq(schema.classPackages.id, chosen.bundle.id))

    for (const s of [plain, skipped, chosen]) {
      const none = await entityIds(s)
      if (s !== chosen) assert.deepEqual(Object.values(none), [null, null, null, null], 'made as a package from before Entities is: no Entity')
    }

    await migrate()
    const yoga = plain.entities[0]!.id
    assert.deepEqual(await entityIds(plain), { bundle: yoga, archived: yoga, pt: yoga, corporate: yoga }, 'an archived package is placed too')
    const reformer = skipped.entities[1]!.id
    assert.deepEqual(await entityIds(skipped), { bundle: reformer, archived: reformer, pt: reformer, corporate: reformer }, 'an archived Entity is passed over')
    assert.deepEqual(
      await entityIds(chosen),
      { bundle: chosen.entities[1]!.id, archived: chosen.entities[0]!.id, pt: chosen.entities[0]!.id, corporate: chosen.entities[0]!.id },
      'a package that names an Entity keeps it',
    )

    const after = await Promise.all([plain, skipped, chosen].map(entityIds))
    await migrate()
    assert.deepEqual(await Promise.all([plain, skipped, chosen].map(entityIds)), after)

    // Every package on the platform now has an Entity, the fixtures' included.
    const [left] = await harness.db.execute<{ n: number }>(sql`
      SELECT (SELECT count(*) FROM class_packages WHERE entity_id IS NULL)
           + (SELECT count(*) FROM pt_packages WHERE entity_id IS NULL)
           + (SELECT count(*) FROM corporate_packages WHERE entity_id IS NULL) AS n
    `)
    assert.equal(Number(left!.n), 0)
  })
})
