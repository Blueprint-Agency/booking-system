import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { MailReporter, ResendClient, ResendPayload, ResendResponse } from '../lib/send-gate'

/**
 * `sendTemplatedEmail` through the Resend transport and its send gate, with a
 * scripted fake standing in for Resend — the pacing and retry rules themselves
 * are pinned in `lib/send-gate.test.ts`; this is what a studio's message looks
 * like when it reaches the gate, and what `email_log` says afterwards.
 */
describe('mail through the send gate', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let mailer!: typeof import('../lib/mailer')
  let send!: typeof import('../services/notifications/send')
  let withTenant!: typeof import('../db')['withTenant']
  let db!: typeof import('../db')['db']

  const run = Date.now().toString(36)
  const at = (name: string) => `${name}-${run}@send-gate.test`

  const calls: { payload: ResendPayload; idempotencyKey: string }[] = []
  const script: ResendResponse[] = []
  const alerts: string[] = []
  let restore: () => void = () => {}

  const client: ResendClient = {
    async send(payload, options) {
      calls.push({ payload, idempotencyKey: options.idempotencyKey })
      return script.shift() ?? { data: { id: `fake-${calls.length}` }, error: null, headers: {} }
    },
  }
  const reporter: MailReporter = {
    warn: () => {},
    alert: code => alerts.push(code),
    usage: () => {},
  }

  const logRow = async (tenantId: string, email: string) => {
    const [row] = await harness.db
      .select()
      .from(schema.emailLog)
      .where(and(eq(schema.emailLog.tenantId, tenantId), eq(schema.emailLog.recipientEmail, email)))
    return row
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    mailer = await import('../lib/mailer')
    send = await import('../services/notifications/send')
    ;({ withTenant, db } = await import('../db'))
    restore = mailer.useTransport(mailer.createResendTransport(client, { report: reporter }))
  })

  after(async () => {
    restore()
    await harness?.close()
  })

  test("a studio's message leaves on noreply@ wearing the studio's name, tagged and keyed by its log row", async () => {
    const { one } = harness.tenants
    const email = at('welcome')
    await withTenant(one.id, () =>
      send.sendTemplatedEmail({
        tenantId: one.id,
        slug: 'welcome',
        recipient: { email, userKind: 'client' },
        variables: { name: 'Probe' },
      }),
    )

    const identity = await withTenant(one.id, async () => {
      const { tenantMailIdentity } = await import('../services/tenants/mail-identity')
      return tenantMailIdentity(one.id)
    })
    const call = calls.find(c => c.payload.to === email)!
    assert.equal(call.payload.from, `"${identity.fromName}" <noreply@reservetoday.app>`)
    assert.notEqual(identity.fromName, 'ReserveToday', "the studio's own name, not the platform's")

    const row = await logRow(one.id, email)
    assert.equal(row?.status, 'sent')
    assert.equal(call.idempotencyKey, row!.id)
    assert.deepEqual(call.payload.tags, [
      { name: 'kind', value: 'everyday' },
      { name: 'template', value: 'welcome' },
      { name: 'tenant', value: one.id },
    ])
  })

  test('a sign-in code is tagged as credential mail', async () => {
    const { two } = harness.tenants
    const email = at('code')
    await withTenant(two.id, () =>
      send.sendTemplatedEmail({
        tenantId: two.id,
        slug: 'sign_in_code',
        recipient: { email, userKind: 'client' },
        variables: { code: '123456' },
        secretVariables: ['code'],
      }),
    )
    const call = calls.find(c => c.payload.to === email)!
    assert.deepEqual(call.payload.tags.find(t => t.name === 'kind'), { name: 'kind', value: 'credential' })
    assert.deepEqual(call.payload.tags.find(t => t.name === 'tenant'), { name: 'tenant', value: two.id })
  })

  test('a quota refusal is not retried, files the send as failed and raises the quota alert', async () => {
    const { one } = harness.tenants
    const email = at('quota')
    script.push({
      data: null,
      error: { name: 'daily_quota_exceeded', message: 'You have reached your daily email sending quota.', statusCode: 429 },
      headers: { 'retry-after': '1' },
    })
    await withTenant(one.id, () =>
      send.sendTemplatedEmail({
        tenantId: one.id,
        slug: 'welcome',
        recipient: { email, userKind: 'client' },
        variables: { name: 'Probe' },
      }),
    )

    assert.equal(calls.filter(c => c.payload.to === email).length, 1, 'tried once')
    const row = await logRow(one.id, email)
    assert.equal(row?.status, 'failed')
    assert.match(row!.error ?? '', /daily_quota_exceeded/)
    assert.deepEqual(alerts, ['mail_quota_exhausted'])
  })

  test("today's count reads every tenant's sent mail", async () => {
    const { one, two } = harness.tenants
    const count = () =>
      withTenant(one.id, async () => {
        const { sql } = await import('drizzle-orm')
        const rows = (await db.execute(sql`SELECT public.email_log_sent_today() AS sent`)) as unknown as { sent: number }[]
        return Number(rows[0]!.sent)
      })

    const before = await count()
    for (const tenant of [one, two]) {
      await harness.db.insert(schema.emailLog).values({
        tenantId: tenant.id,
        templateSlug: 'welcome',
        recipientEmail: at(`counted-${tenant.slug}`),
        recipientUserKind: 'client',
        subjectRendered: 's',
        bodyRendered: 'b',
        status: 'sent',
        sentAt: new Date(),
      })
    }
    assert.equal(await count(), before + 2, "the other studio's mail counts too")
  })
})
