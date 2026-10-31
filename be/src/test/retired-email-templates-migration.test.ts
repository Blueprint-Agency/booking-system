import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const MIGRATION = path.resolve(process.cwd(), 'src/db/migrations/0138_retire_unsent_email_templates.sql')
const RETIRED = ['welcome', 'referral_credited', 'pt_session_declined', 'workshop_waitlist_promoted']

/**
 * Migration 0138: a studio created before the `welcome`, `referral_credited`,
 * `pt_session_declined` and `workshop_waitlist_promoted` templates were retired
 * (nothing sends any of them) loses all four rows, the ones it edited as much
 * as the ones it never touched, and keeps every other template. A switch row
 * for any of them goes too.
 *
 * Two throwaway studios, provisioned with today's templates, then given the
 * four rows an older studio holds. The migration's own SQL is run against them,
 * twice.
 */
describe('migration 0138: the retired email templates leave studios created before', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  const studios: Array<{ id: string; slug: string }> = []

  async function slugsOf(tenantId: string): Promise<string[]> {
    const rows = await harness.db.select({ slug: schema.emailTemplates.slug }).from(schema.emailTemplates).where(eq(schema.emailTemplates.tenantId, tenantId))
    return rows.map(r => r.slug).sort()
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
    for (const slug of [`retired-a-${run}`, `retired-b-${run}`]) {
      const { tenant } = await provision.provisionTenant({ slug, name: `Retired Studio ${slug}`, adminEmail: `owner@${slug}.test` })
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

  async function switchSlugsOf(tenantId: string): Promise<string[]> {
    const rows = await harness.db.select({ slug: schema.emailSwitches.slug }).from(schema.emailSwitches).where(eq(schema.emailSwitches.tenantId, tenantId))
    return rows.map(r => r.slug).sort()
  }

  test('NTF-51 all four retired templates are removed from every studio, an edited one included, with their switches, every other template stays, and a second run changes nothing', async () => {
    const [plain, edited] = [studios[0]!, studios[1]!]
    const kept = await slugsOf(plain.id)
    assert.ok(!kept.some(s => RETIRED.includes(s)), 'a studio created today is not given any of them')

    // A studio that had switched off one of the retired emails, and another that is still sent.
    await harness.db.insert(schema.emailSwitches).values([
      ...RETIRED.map(slug => ({ tenantId: edited.id, slug, enabled: false })),
      { tenantId: edited.id, slug: 'pt_request_submitted', enabled: false },
    ])

    for (const studio of studios) {
      await harness.db.insert(schema.emailTemplates).values(
        RETIRED.map(slug => ({
          tenantId: studio.id,
          slug,
          subject: studio === edited ? `${slug} in the studio's own words` : `${slug} as shipped`,
          bodyHtml: '<p>old</p>',
        })),
      )
    }
    assert.deepEqual(await slugsOf(plain.id), [...kept, ...RETIRED].sort(), 'both studios hold the old rows before')
    assert.deepEqual(await slugsOf(edited.id), [...kept, ...RETIRED].sort())

    await migrate()
    assert.deepEqual(await slugsOf(plain.id), kept, 'the untouched studio keeps every other template')
    assert.deepEqual(await slugsOf(edited.id), kept, 'the studio that edited them loses them too')
    assert.deepEqual(await switchSlugsOf(edited.id), ['pt_request_submitted'], 'their switches go, a live email\'s stays')

    await migrate()
    assert.deepEqual(await slugsOf(plain.id), kept, 'a second run changes nothing')
    assert.deepEqual(await slugsOf(edited.id), kept)
    assert.deepEqual(await switchSlugsOf(edited.id), ['pt_request_submitted'])
  })
})
