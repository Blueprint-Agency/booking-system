import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const MIGRATION = path.resolve(process.cwd(), 'src/db/migrations/0109_corporate_purchase_template.sql')
const SLUG = 'corporate_purchase_confirmed'

/**
 * Migration 0109 (#359): a paid corporate package is confirmed by email, on a
 * template studios created before it do not have. The migration adds the
 * default wording to every studio without the row, and never touches a row a
 * studio already has.
 *
 * Two throwaway studios, provisioned with today's templates: one has its row
 * taken away, as a studio created before the template has none; the other has
 * its own wording. The migration's own SQL is run against them, twice.
 */
describe('migration 0109: the corporate confirmation reaches studios created before it', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  const studios: Array<{ id: string; slug: string }> = []

  type Row = { tenantId: string; subject: string; bodyHtml: string; updatedAt: Date }

  async function rows(): Promise<Record<string, Row>> {
    const found = await harness.db
      .select({
        tenantId: schema.emailTemplates.tenantId,
        subject: schema.emailTemplates.subject,
        bodyHtml: schema.emailTemplates.bodyHtml,
        updatedAt: schema.emailTemplates.updatedAt,
      })
      .from(schema.emailTemplates)
      .where(and(eq(schema.emailTemplates.slug, SLUG), inArray(schema.emailTemplates.tenantId, studios.map(s => s.id))))
    return Object.fromEntries(found.map(r => [r.tenantId, r]))
  }

  /** The migration as the migrator runs it: statement by statement, as the owner. */
  async function migrate() {
    for (const statement of readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint')) {
      await harness.db.execute(sql.raw(statement))
    }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    const provision = await import('../services/tenants/provision')
    for (const slug of [`corp-mail-a-${run}`, `corp-mail-b-${run}`]) {
      // With a first Admin, which is when a studio is given the default copy.
      const { tenant } = await provision.provisionTenant({ slug, name: `Corporate Mail ${slug}`, adminEmail: `owner@${slug}.test` })
      studios.push({ id: tenant.id, slug })
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

  test('NTF-03 a studio without the corporate confirmation is given the default a studio created today has, one with its own wording is untouched, and a second run changes nothing', async () => {
    const [without, edited] = [studios[0]!, studios[1]!]
    const today = await rows()
    assert.ok(today[without.id] && today[edited.id], 'a studio created today has the corporate confirmation')

    await harness.db
      .delete(schema.emailTemplates)
      .where(and(eq(schema.emailTemplates.tenantId, without.id), eq(schema.emailTemplates.slug, SLUG)))
    await harness.db
      .update(schema.emailTemplates)
      .set({ subject: 'Thanks for booking your team in', bodyHtml: '<p>Dear {{client_name}}, we will call you.</p>' })
      .where(and(eq(schema.emailTemplates.tenantId, edited.id), eq(schema.emailTemplates.slug, SLUG)))
    const editedBefore = (await rows())[edited.id]
    assert.equal((await rows())[without.id], undefined, 'the row is gone')

    await migrate()

    const migrated = await rows()
    assert.equal(migrated[without.id]?.subject, today[without.id]!.subject, 'the subject a studio created today is given')
    assert.equal(migrated[without.id]?.bodyHtml, today[without.id]!.bodyHtml, 'the body a studio created today is given')
    assert.deepEqual(migrated[edited.id], editedBefore, 'a studio\'s own wording is exactly as it was')

    await migrate()
    assert.deepEqual(await rows(), migrated, 'a second run changes nothing')
  })

  test('NTF-03 every studio has the corporate confirmation after the migration, the fixtures\' own rows unchanged', async () => {
    const fixtures = [harness.tenants.one.id, harness.tenants.two.id]
    const read = () =>
      harness.db
        .select()
        .from(schema.emailTemplates)
        .where(and(eq(schema.emailTemplates.slug, SLUG), inArray(schema.emailTemplates.tenantId, fixtures)))
    const before = await read()
    assert.equal(before.length, 2, 'both fixtures were given it when they were seeded')

    await migrate()

    assert.deepEqual(await read(), before, 'an existing row is never touched')
    const [missing] = await harness.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM tenants t
      WHERE NOT EXISTS (SELECT 1 FROM email_templates e WHERE e.tenant_id = t.id AND e.slug = ${SLUG})`)
    assert.equal(missing!.n, 0, 'no studio is left without it')
  })
})
