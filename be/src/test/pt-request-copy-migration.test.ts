import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const MIGRATION = path.resolve(process.cwd(), 'src/db/migrations/0139_pt_request_copy_held_session.sql')
const SLUGS = ['pt_request_submitted', 'pt_request_expired']

/**
 * Migration 0139: the request-received and request-expired emails stopped
 * saying a private session request deducts nothing, because submitting one
 * debits the package. A studio created before gets the true wording in a row
 * still exactly the default it was written with, and never in a row it has put
 * its own words in.
 *
 * Two throwaway studios, provisioned with today's templates. The "before" text
 * is the copy as it shipped, written out here with the shared layout helpers,
 * its link carrying the studio's own origin as the seeder baked it. The
 * migration's own SQL is run against them, twice.
 */
describe('migration 0139: the private session request emails say the session is held, in studios created before', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let layout!: typeof import('../services/mail/layout')
  let tenantOrigin!: typeof import('../lib/allowed-origins').tenantOrigin
  const studios: Array<{ id: string; slug: string }> = []

  type Row = { subject: string; bodyHtml: string }

  async function templatesOf(tenantId: string): Promise<Record<string, Row>> {
    const rows = await harness.db
      .select({ slug: schema.emailTemplates.slug, subject: schema.emailTemplates.subject, bodyHtml: schema.emailTemplates.bodyHtml })
      .from(schema.emailTemplates)
      .where(and(eq(schema.emailTemplates.tenantId, tenantId), inArray(schema.emailTemplates.slug, SLUGS)))
    return Object.fromEntries(rows.map(r => [r.slug, { subject: r.subject, bodyHtml: r.bodyHtml }]))
  }

  async function store(tenantId: string, slug: string, values: Row) {
    await harness.db
      .update(schema.emailTemplates)
      .set(values)
      .where(and(eq(schema.emailTemplates.tenantId, tenantId), eq(schema.emailTemplates.slug, slug)))
  }

  /** The migration as the migrator runs it: statement by statement, as the owner. */
  async function migrate() {
    for (const statement of readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint')) {
      await harness.db.execute(sql.raw(statement))
    }
  }

  /** The two bodies as they shipped before the migration, for one studio's member app origin. */
  function shippedBefore(slug: string): Record<string, string> {
    const { emailHeading, emailParagraph, emailLink } = layout
    const client = tenantOrigin('client', slug)!
    const link = (href: string, label: string) => emailLink(href, `${label} →`)
    return {
      pt_request_submitted: [
        emailHeading('Your private session request was received'),
        emailParagraph('Hi {{client_name}},'),
        emailParagraph('You asked <strong>{{instructor_name}}</strong> for a private session on <strong>{{starts_at}}</strong>.'),
        emailParagraph('Nothing is confirmed and no session has been deducted yet. Your account shows the request and its outcome once the instructor has answered.'),
        emailParagraph(link(`${client}/account`, 'View your requests')),
      ].join('\n'),
      pt_request_expired: [
        emailHeading('Your private session request expired'),
        emailParagraph('Hi {{client_name}},'),
        emailParagraph('Your request to <strong>{{instructor_name}}</strong> for <strong>{{starts_at}}</strong> was not answered in time, so it has expired.'),
        emailParagraph(`Nothing was deducted. ${link(`${client}/account`, 'Request another time')}`),
      ].join('\n'),
    }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    layout = await import('../services/mail/layout')
    tenantOrigin = (await import('../lib/allowed-origins')).tenantOrigin
    const provision = await import('../services/tenants/provision')
    for (const slug of [`ptcopy-a-${run}`, `ptcopy-b-${run}`]) {
      const { tenant } = await provision.provisionTenant({ slug, name: `PT Copy Studio ${slug}`, adminEmail: `owner@${slug}.test` })
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

  test('NTF-62 a studio still holding the shipped default gets the true wording, its own link and footer note kept, a row it rewrote is left byte for byte, and a second run changes nothing', async () => {
    const [plain, edited] = [studios[0]!, studios[1]!]

    const today = await templatesOf(plain.id)
    for (const slug of SLUGS) {
      assert.ok(!/deducted/i.test(today[slug]!.bodyHtml), `${slug}: a studio created today is given wording that does not deny the debit`)
    }

    // The studio created before: both rows as they shipped, the expired one with a footer note.
    const shipped = shippedBefore(plain.slug)
    const footer = layout.emailFooterNote('1 Test Street')
    await store(plain.id, 'pt_request_submitted', { subject: today.pt_request_submitted!.subject, bodyHtml: shipped.pt_request_submitted! })
    await store(plain.id, 'pt_request_expired', { subject: today.pt_request_expired!.subject, bodyHtml: `${shipped.pt_request_expired}\n${footer}` })

    // The studio that rewrote one row, and kept the other as shipped but for a changed subject.
    const own = { subject: 'We could not fit you in', bodyHtml: '<p>Sorry, {{client_name}}. Nothing was deducted.</p>' }
    const shippedEdited = shippedBefore(edited.slug)
    const keptButRetitled = { subject: 'Your request lapsed', bodyHtml: shippedEdited.pt_request_expired! }
    await store(edited.id, 'pt_request_submitted', own)
    await store(edited.id, 'pt_request_expired', keptButRetitled)

    await migrate()

    const after = await templatesOf(plain.id)
    assert.match(after.pt_request_submitted!.bodyHtml, /The session for this request is held from your package until it is answered\./)
    assert.ok(!/deducted/i.test(after.pt_request_submitted!.bodyHtml))
    assert.ok(after.pt_request_submitted!.bodyHtml.includes(`href="${tenantOrigin('client', plain.slug)}/account"`), "the studio's own member app link stays")
    assert.equal(after.pt_request_submitted!.subject, today.pt_request_submitted!.subject)
    assert.ok(after.pt_request_expired!.bodyHtml.includes('{{refund_line}}'), 'the expired email takes its refund sentence from a variable')
    assert.ok(!/deducted/i.test(after.pt_request_expired!.bodyHtml))
    assert.ok(after.pt_request_expired!.bodyHtml.endsWith(`\n${footer}`), 'the footer note stays')
    assert.ok(after.pt_request_expired!.bodyHtml.includes(`href="${tenantOrigin('client', plain.slug)}/account"`))

    // What the migration wrote is exactly what a studio created today was given, footer aside.
    assert.equal(after.pt_request_submitted!.bodyHtml, today.pt_request_submitted!.bodyHtml, 'the migrated default is byte for byte the one a new studio is given')
    assert.equal(after.pt_request_expired!.bodyHtml, `${today.pt_request_expired!.bodyHtml}\n${footer}`)

    const editedAfter = await templatesOf(edited.id)
    assert.deepEqual(editedAfter.pt_request_submitted, own, "a studio's own wording is untouched")
    assert.deepEqual(editedAfter.pt_request_expired, keptButRetitled, 'a row whose subject was changed is a studio edit, and is left alone')

    await migrate()
    assert.deepEqual(await templatesOf(plain.id), after, 'a second run changes nothing')
    assert.deepEqual(await templatesOf(edited.id), editedAfter)
  })
})
