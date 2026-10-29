import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const MIGRATION = path.resolve(process.cwd(), 'src/db/migrations/0117_business_name_mail.sql')
/** The latest migration to define `current_tenant_mail_identity()`. */
const LATEST_MAIL_IDENTITY = path.resolve(process.cwd(), 'src/db/migrations/0120_display_name_mail.sql')

/**
 * Migration 0117: templates name the studio by `{{studio_name}}`,
 * filled with its Business name when each email is sent. Studios created
 * before were given their name written into the text, so the migration swaps
 * the placeholder in for it, but only in a template still exactly the default
 * it was given.
 *
 * Throwaway studios, provisioned with today's templates. Each template is put
 * back to the default as it was written before the placeholder — today's copy with the
 * studio's name in place of the placeholder, raw in a subject and escaped in a
 * body — and one studio's are then edited. The migration's own SQL is run
 * against them, twice, as the migrator runs it.
 */
describe('migration 0117: provisioned templates follow the Business name', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let emailFooterNote!: typeof import('../services/mail/layout').emailFooterNote
  const studios: Array<{ id: string; slug: string; name: string }> = []

  type Row = { slug: string; subject: string; bodyHtml: string; updatedAt: Date }

  async function templatesOf(tenantId: string): Promise<Record<string, Row>> {
    const rows = await harness.db
      .select({
        slug: schema.emailTemplates.slug,
        subject: schema.emailTemplates.subject,
        bodyHtml: schema.emailTemplates.bodyHtml,
        updatedAt: schema.emailTemplates.updatedAt,
      })
      .from(schema.emailTemplates)
      .where(eq(schema.emailTemplates.tenantId, tenantId))
    return Object.fromEntries(rows.map(r => [r.slug, r]))
  }

  const words = (rows: Record<string, Row>) =>
    Object.fromEntries(Object.entries(rows).map(([slug, r]) => [slug, { subject: r.subject, bodyHtml: r.bodyHtml }]))

  async function write(tenantId: string, slug: string, subject: string, bodyHtml: string) {
    await harness.db
      .update(schema.emailTemplates)
      .set({ subject, bodyHtml })
      .where(and(eq(schema.emailTemplates.tenantId, tenantId), eq(schema.emailTemplates.slug, slug)))
  }

  /** The templates a studio was given before the placeholder: its name written in, and its footer note when it had one. */
  async function writtenBefore400(studio: { id: string; slug: string; name: string }, footer?: string) {
    const { buildEmailTemplates } = await import('../db/seed/email-copy')
    const { tenantOrigin } = await import('../lib/allowed-origins')
    const old = buildEmailTemplates({
      clientUrl: tenantOrigin('client', studio.slug)!,
      portalUrl: tenantOrigin('portal', studio.slug)!,
      studio: { name: studio.name, footer },
    })
    for (const t of old) await write(studio.id, t.slug, t.subject, t.bodyHtml)
    return Object.fromEntries(old.map(t => [t.slug, t]))
  }

  /** The migration as the migrator runs it: statement by statement, as the owner, in one transaction. */
  async function migrate() {
    await harness.db.transaction(async tx => {
      for (const statement of readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint')) {
        await tx.execute(sql.raw(statement))
      }
    })
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ emailFooterNote } = await import('../services/mail/layout'))
    const provision = await import('../services/tenants/provision')
    // One name that escapes in HTML, one that does not.
    for (const [slug, name] of [
      [`studio-name-a-${run}`, `Northwind ${run} & "Partners"`],
      [`studio-name-b-${run}`, `Acme ${run} Movement`],
    ] as const) {
      const { tenant } = await provision.provisionTenant({ slug, name, adminEmail: `owner@${slug}.test` })
      studios.push({ id: tenant.id, slug, name })
    }
  })

  after(async () => {
    if (!harness) return
    try {
      // Re-running 0117 put `current_tenant_mail_identity()` back in 0117's
      // shape, in the database every later test file shares; the migration
      // that redefined it since brings it back to today's. Its EXECUTE grant
      // is restored by the next startTestApp (db/roles.ts).
      await harness.db.transaction(async tx => {
        for (const statement of readFileSync(LATEST_MAIL_IDENTITY, 'utf8').split('--> statement-breakpoint')) {
          await tx.execute(sql.raw(statement))
        }
      })
      const { deleteTenant } = await import('../services/tenants/delete')
      for (const { id, slug } of studios) {
        await harness.db.execute(sql`UPDATE tenants SET status = 'suspended' WHERE id = ${id}`)
        await deleteTenant({ tenantId: id, confirmSlug: slug })
      }
    } finally {
      await harness.close()
    }
  })

  test('NTF-25 a studio created before #400 has its unedited templates name it by the placeholder, as a studio created today, its footer note kept; an edited template stays byte for byte; a second run changes nothing', async () => {
    const [unedited, edited] = [studios[0]!, studios[1]!]
    const today = { [unedited.id]: words(await templatesOf(unedited.id)), [edited.id]: words(await templatesOf(edited.id)) }
    assert.ok(
      today[unedited.id]!.sign_in_code!.subject.includes('{{studio_name}}'),
      'a studio created today is given the placeholder, not its name',
    )
    for (const studio of studios) {
      const all = JSON.stringify(today[studio.id])
      assert.ok(!all.includes(studio.name) && !all.includes(studio.name.replace('&', '&amp;')), `nothing names ${studio.name}`)
    }

    // Before the placeholder: the name written in. The first studio carries a footer note,
    // as the isolation fixtures do.
    const FOOTER = `1 Example Street & Lane ${run}.`
    const old = { [unedited.id]: await writtenBefore400(unedited, FOOTER), [edited.id]: await writtenBefore400(edited) }
    assert.ok(old[unedited.id]!.welcome!.subject.includes(unedited.name), 'the old subject names the studio raw')
    assert.ok(old[unedited.id]!.welcome!.bodyHtml.includes('Northwind ' + run + ' &amp; &quot;Partners&quot;'), 'the old body names it escaped')

    // The second studio's own wording, in two of the ten templates that name it.
    await write(edited.id, 'welcome', `Hello from ${edited.name}`, old[edited.id]!.welcome!.bodyHtml)
    await write(edited.id, 'sign_in_code', old[edited.id]!.sign_in_code!.subject, `${old[edited.id]!.sign_in_code!.bodyHtml}\n<p>See you at ${edited.name}.</p>`)
    const editedBefore = await templatesOf(edited.id)

    await migrate()

    const first = await templatesOf(unedited.id)
    for (const [slug, expected] of Object.entries(today[unedited.id]!)) {
      assert.equal(first[slug]!.subject, expected.subject, `${slug}: the subject a studio created today has`)
      assert.equal(first[slug]!.bodyHtml, `${expected.bodyHtml}\n${emailFooterNote(FOOTER)}`, `${slug}: the body a studio created today has, its footer note kept`)
    }

    const second = await templatesOf(edited.id)
    for (const slug of ['welcome', 'sign_in_code']) {
      assert.deepEqual(second[slug], editedBefore[slug], `${slug}: the studio's own wording is exactly as it was`)
    }
    for (const [slug, expected] of Object.entries(today[edited.id]!)) {
      if (slug === 'welcome' || slug === 'sign_in_code') continue
      assert.deepEqual({ subject: second[slug]!.subject, bodyHtml: second[slug]!.bodyHtml }, expected, `${slug}: the default it was given now names it by the placeholder`)
    }

    const migrated = { [unedited.id]: first, [edited.id]: second }
    await migrate()
    for (const studio of studios) {
      assert.deepEqual(await templatesOf(studio.id), migrated[studio.id], `${studio.name}: a second run changes nothing`)
    }
  })

  test('NTF-25 a studio renamed since its templates were written keeps them as they are, and the fixtures created today are untouched', async () => {
    const studio = studios[1]!
    await writtenBefore400(studio)
    await harness.db.execute(sql`UPDATE tenants SET name = ${`${studio.name} Renamed`} WHERE id = ${studio.id}`)
    const renamed = await templatesOf(studio.id)

    const fixtures = [harness.tenants.one.id, harness.tenants.two.id]
    const read = () =>
      harness.db.select().from(schema.emailTemplates).where(inArray(schema.emailTemplates.tenantId, fixtures))
    const fixturesBefore = await read()

    await migrate()

    assert.deepEqual(await templatesOf(studio.id), renamed, 'its name no longer matches what was written, so nothing is swapped')
    assert.deepEqual(await read(), fixturesBefore, 'a template already naming the studio by the placeholder is never touched')
  })
})
