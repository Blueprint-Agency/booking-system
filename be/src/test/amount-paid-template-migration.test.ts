import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const MIGRATION = path.resolve(process.cwd(), 'src/db/migrations/0105_purchase_confirmation_amount_paid.sql')
const SLUGS = ['package_purchase_confirmed', 'trial_pass_purchase_confirmed', 'workshop_purchase_confirmed']

/**
 * Migration 0105 (#370, #373): studios created before the purchase
 * confirmations said what the member paid get the "Amount paid" row too, but
 * only in a template still exactly as it was written for them.
 *
 * Two throwaway studios, provisioned with today's templates. Each template is
 * put back to the default as it was before #370 — today's with its Amount paid
 * row taken out — and studio two's are then edited. The migration's own SQL is
 * run against them, twice.
 */
describe('migration 0105: the amount paid reaches unedited purchase confirmations', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let emailFooterNote!: typeof import('../services/mail/layout').emailFooterNote
  const studios: Array<{ id: string; slug: string }> = []

  type Row = { slug: string; subject: string; bodyHtml: string; updatedAt: Date }

  /** The Amount paid row emailDetails writes, and the line break before it. */
  const AMOUNT_ROW = /\n {2}<tr>\n {4}<td data-text="label"[^>]*>Amount paid<\/td>\n {4}<td[^>]*>\{\{amount_paid\}\}<\/td>\n {2}<\/tr>/

  async function templatesOf(tenantId: string): Promise<Record<string, Row>> {
    const rows = await harness.db
      .select({
        slug: schema.emailTemplates.slug,
        subject: schema.emailTemplates.subject,
        bodyHtml: schema.emailTemplates.bodyHtml,
        updatedAt: schema.emailTemplates.updatedAt,
      })
      .from(schema.emailTemplates)
      .where(and(eq(schema.emailTemplates.tenantId, tenantId), inArray(schema.emailTemplates.slug, SLUGS)))
    return Object.fromEntries(rows.map(r => [r.slug, r]))
  }

  async function store(tenantId: string, slug: string, values: { subject?: string; bodyHtml: string }) {
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

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ emailFooterNote } = await import('../services/mail/layout'))
    const provision = await import('../services/tenants/provision')
    // A name with every character escapeHtml rewrites, so the trial pass's
    // heading holds it escaped and its subject holds it raw.
    for (const [slug, name] of [
      [`amount-a-${run}`, `O'Neil & "Sons" <Yoga> ${run}`],
      [`amount-b-${run}`, `Edited Studio ${run}`],
    ] as const) {
      // With a first Admin, which is when a studio is given the default copy.
      const { tenant } = await provision.provisionTenant({ slug, name, adminEmail: `owner@${slug}.test` })
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

  test('NTF-03 an unedited confirmation gains the Amount paid row, an edited one is untouched, and a second run changes nothing', async () => {
    const [unedited, edited] = [studios[0]!, studios[1]!]
    const today = { unedited: await templatesOf(unedited.id), edited: await templatesOf(edited.id) }
    const before370 = (row: Row) => {
      const body = row.bodyHtml.replace(AMOUNT_ROW, '')
      assert.notEqual(body, row.bodyHtml, `${row.slug} carries an Amount paid row today`)
      return body
    }
    const FOOTER = emailFooterNote(`1 ${run} Street`)

    // Studio one: the defaults as written before #370; its workshop template
    // also carries a footer note, as a fixture's do.
    for (const slug of SLUGS) {
      const old = before370(today.unedited[slug]!)
      await store(unedited.id, slug, { bodyHtml: slug === 'workshop_purchase_confirmed' ? `${old}\n${FOOTER}` : old })
    }
    // Studio two: the same, then edited, in the body or in the subject.
    await store(edited.id, 'package_purchase_confirmed', {
      bodyHtml: before370(today.edited.package_purchase_confirmed!).replace('Your package is confirmed', 'Thanks for your order'),
    })
    await store(edited.id, 'trial_pass_purchase_confirmed', {
      subject: 'Welcome aboard',
      bodyHtml: before370(today.edited.trial_pass_purchase_confirmed!),
    })
    await store(edited.id, 'workshop_purchase_confirmed', {
      bodyHtml: before370(today.edited.workshop_purchase_confirmed!).replace('Your check-in code is', 'Show this code at the door:'),
    })
    const editedBefore = await templatesOf(edited.id)

    await migrate()

    const migrated = await templatesOf(unedited.id)
    for (const slug of SLUGS) {
      const expected = today.unedited[slug]!
      assert.equal(migrated[slug]!.subject, expected.subject, `${slug}: the subject is unchanged`)
      assert.equal(
        migrated[slug]!.bodyHtml,
        slug === 'workshop_purchase_confirmed' ? `${expected.bodyHtml}\n${FOOTER}` : expected.bodyHtml,
        `${slug}: the body is what a studio created today is given`,
      )
    }
    assert.ok(migrated.trial_pass_purchase_confirmed!.bodyHtml.includes('O&#39;Neil &amp; &quot;Sons&quot; &lt;Yoga&gt;'))
    assert.deepEqual(await templatesOf(edited.id), editedBefore, 'every edited template is exactly as it was')

    const once = { unedited: await templatesOf(unedited.id), edited: await templatesOf(edited.id) }
    await migrate()
    assert.deepEqual(
      { unedited: await templatesOf(unedited.id), edited: await templatesOf(edited.id) },
      once,
      'a second run changes nothing',
    )
  })
})
