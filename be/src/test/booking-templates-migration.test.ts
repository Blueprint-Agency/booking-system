import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const MIGRATION = path.resolve(process.cwd(), 'src/db/migrations/0108_booking_notification_templates.sql')
const SLUGS = [
  'class_booking_confirmed',
  'class_cancelled_credit_returned',
  'pt_cancelled_session_returned',
  'admin_cancel_class',
  'admin_cancel_pt',
  'admin_cancel_workshop',
  'checkin_nag',
  'pt_request_cancelled',
]

/**
 * Migration 0108 (#359): studios created before the booking and cancellation
 * emails were sent get their new wording — in a template still exactly the
 * default it was written with, and a new row where they have none — while a
 * studio's own wording is never touched.
 *
 * Two throwaway studios, provisioned with today's templates. The "before"
 * text is the copy as it shipped before #359, written out here from that
 * release with the shared layout helpers — the links carrying the studio's own
 * origin, as the seeder baked them. The migration's own SQL is run against
 * them, twice.
 */
describe('migration 0108:the booking emails reach studios created before them', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let layout!: typeof import('../services/mail/layout')
  let tenantOrigin!: typeof import('../lib/allowed-origins').tenantOrigin
  const studios: Array<{ id: string; slug: string }> = []

  type Row = { slug: string; subject: string; bodyHtml: string }

  async function templatesOf(tenantId: string): Promise<Record<string, Row>> {
    const rows = await harness.db
      .select({ slug: schema.emailTemplates.slug, subject: schema.emailTemplates.subject, bodyHtml: schema.emailTemplates.bodyHtml })
      .from(schema.emailTemplates)
      .where(and(eq(schema.emailTemplates.tenantId, tenantId), inArray(schema.emailTemplates.slug, SLUGS)))
    return Object.fromEntries(rows.map(r => [r.slug, r]))
  }

  async function store(tenantId: string, slug: string, values: { subject: string; bodyHtml: string }) {
    await harness.db
      .update(schema.emailTemplates)
      .set(values)
      .where(and(eq(schema.emailTemplates.tenantId, tenantId), eq(schema.emailTemplates.slug, slug)))
  }

  async function drop(tenantId: string, slug: string) {
    await harness.db
      .delete(schema.emailTemplates)
      .where(and(eq(schema.emailTemplates.tenantId, tenantId), eq(schema.emailTemplates.slug, slug)))
  }

  /** The migration as the migrator runs it: statement by statement, as the owner. */
  async function migrate() {
    for (const statement of readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint')) {
      await harness.db.execute(sql.raw(statement))
    }
  }

  /** The seven templates as they shipped before #359, for one studio's origins. */
  function before359(slug: string): Record<string, { subject: string; bodyHtml: string }> {
    const { emailHeading, emailParagraph, emailButton, emailNote, emailLink, emailDetails } = layout
    const client = tenantOrigin('client', slug)!
    const portal = tenantOrigin('portal', slug)!
    const body = (heading: string, lines: string[], opts: { cta?: { href: string; label: string }; note?: string } = {}) =>
      [
        emailHeading(heading),
        ...lines.map(l => (/^<(table|p)[\s>]/.test(l) ? l : emailParagraph(l))),
        opts.cta ? emailButton(opts.cta.href, opts.cta.label) : '',
        opts.note ? emailNote(opts.note) : '',
      ]
        .filter(Boolean)
        .join('\n')
    const link = (href: string, label: string) => emailLink(href, `${label} →`)
    return {
      class_booking_confirmed: {
        subject: '{{class_name}} on {{date}} is booked',
        bodyHtml: body(
          'Your class is booked',
          [
            'Hi {{client_name}},',
            emailDetails([
              ['Class', '{{class_name}}'],
              ['When', '{{date}}'],
              ['With', '{{instructor_name}}'],
              ['Where', '{{location}}'],
            ]),
            'Your check-in code is <strong>{{code}}</strong>. Show it at the studio, or open the QR code below.',
            link('{{qr_url}}', 'Show your QR code'),
          ],
          { note: 'Credits remaining: <strong>{{credits_remaining}}</strong>.' },
        ),
      },
      class_cancelled_credit_returned: {
        subject: 'Your class was cancelled — credit returned',
        bodyHtml: body('Your booking is cancelled — credit returned', [
          'Hi {{client_name}},',
          'Your booking for <strong>{{class_name}}</strong> on <strong>{{date}}</strong> has been cancelled.',
          '<strong>{{credits_returned}}</strong> credit(s) are back in your account, ready for another class.',
          link(`${client}/classes`, 'Book another class'),
        ]),
      },
      pt_cancelled_session_returned: {
        subject: 'Your private session was cancelled — session returned',
        bodyHtml: body('Your private session is cancelled — session returned', [
          'Hi {{client_name}},',
          'Your private session with <strong>{{instructor_name}}</strong> on <strong>{{starts_at}}</strong> has been cancelled.',
          `The session is back in your account and can be used for another booking. ${link(`${client}/account`, 'Book another session')}`,
        ]),
      },
      admin_cancel_class: {
        subject: '{{class_name}} on {{date}} was cancelled',
        bodyHtml: body('A class has been cancelled', [
          'Hi {{client_name}},',
          'The studio has cancelled <strong>{{class_name}}</strong> on <strong>{{date}}</strong>. We are sorry for the change of plan.',
          '<strong>{{credits_returned}}</strong> credit(s) have been returned to your account — nothing was charged for the cancelled class.',
          link(`${client}/classes`, 'Find another class'),
        ]),
      },
      admin_cancel_pt: {
        subject: 'Your private session on {{starts_at}} was cancelled',
        bodyHtml: body('A private session has been cancelled', [
          'Hi {{client_name}},',
          'The studio has cancelled your private session with <strong>{{instructor_name}}</strong> on <strong>{{starts_at}}</strong>. We are sorry for the change of plan.',
          `The session is back in your account. ${link(`${client}/account`, 'Book another time')}`,
        ]),
      },
      admin_cancel_workshop: {
        subject: '{{workshop_name}} was cancelled',
        bodyHtml: body('A workshop has been cancelled', [
          'Hi {{client_name}},',
          'The studio has cancelled <strong>{{workshop_name}}</strong>. We are sorry — we know a workshop is a date people plan around.',
          'You paid <strong>SGD {{refund_sgd}}</strong> for your place. The studio is arranging your refund and will contact you to settle it.',
          link(`${client}/workshops`, 'See upcoming workshops'),
        ]),
      },
      checkin_nag: {
        subject: 'Check-in is still open for {{session_label}}',
        bodyHtml: body(
          'Check-in is still open for {{session_label}}',
          [
            'Hi {{instructor_name}},',
            '<strong>{{pending_count}}</strong> member(s) on <strong>{{session_label}}</strong> are still unmarked. Attendance drives credits and payroll, so it needs to be right.',
            'It takes a moment in the portal — mark who came and who did not.',
          ],
          { cta: { href: `${portal}/instructor/classes`, label: 'Complete check-in' } },
        ),
      },
    }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    layout = await import('../services/mail/layout')
    ;({ tenantOrigin } = await import('../lib/allowed-origins'))
    const provision = await import('../services/tenants/provision')
    for (const slug of [`notify-a-${run}`, `notify-b-${run}`]) {
      // With a first Admin, which is when a studio is given the default copy.
      const { tenant } = await provision.provisionTenant({ slug, name: `Notify Studio ${slug}`, adminEmail: `owner@${slug}.test` })
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

  test('NTF-08, NTF-09, NTF-10, NTF-11, NTF-18 an unedited template gains the new wording, a missing one is added, an edited one is untouched, and a second run changes nothing', async () => {
    const [unedited, edited] = [studios[0]!, studios[1]!]
    const today = await templatesOf(unedited.id)
    assert.deepEqual(Object.keys(today).sort(), [...SLUGS].sort(), 'a studio created today has every template')
    const FOOTER = layout.emailFooterNote(`1 ${run} Street`)

    // Studio one: each template as written before #359 — two of them with a
    // footer note, as the fixtures' are — and two rows gone, one of them the
    // template #359 adds.
    const oldA = before359(unedited.slug)
    for (const [slug, old] of Object.entries(oldA)) {
      const withFooter = slug === 'admin_cancel_class' || slug === 'checkin_nag'
      await store(unedited.id, slug, { subject: old.subject, bodyHtml: withFooter ? `${old.bodyHtml}\n${FOOTER}` : old.bodyHtml })
    }
    await drop(unedited.id, 'admin_cancel_pt')
    await drop(unedited.id, 'pt_request_cancelled')

    // Studio two: the same, then edited, in the body or in the subject.
    const oldB = before359(edited.slug)
    for (const [slug, old] of Object.entries(oldB)) {
      const subjectEdited = slug === 'admin_cancel_workshop'
      await store(edited.id, slug, {
        subject: subjectEdited ? 'Workshop called off' : old.subject,
        bodyHtml: subjectEdited ? old.bodyHtml : old.bodyHtml.replace('Hi {{', 'Dear {{'),
      })
    }
    const editedBefore = await templatesOf(edited.id)
    assert.ok(
      Object.entries(oldB).every(([slug]) => editedBefore[slug]!.bodyHtml !== oldB[slug]!.bodyHtml || editedBefore[slug]!.subject !== oldB[slug]!.subject),
      'every studio-two row really differs from the old default',
    )

    await migrate()

    const migrated = await templatesOf(unedited.id)
    for (const slug of SLUGS) {
      const withFooter = slug === 'admin_cancel_class' || slug === 'checkin_nag'
      assert.equal(migrated[slug]?.subject, today[slug]!.subject, `${slug}: the subject a studio created today is given`)
      assert.equal(
        migrated[slug]!.bodyHtml,
        withFooter ? `${today[slug]!.bodyHtml}\n${FOOTER}` : today[slug]!.bodyHtml,
        `${slug}: the body a studio created today is given${withFooter ? ', its footer note kept' : ''}`,
      )
    }
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
