import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { after, afterEach, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { OutcomeAlert } from '../services/notifications/delivery-outcomes'
import type { InboundEmail } from '../services/classpass/receive'
import { classPassEmail } from './classpass-email'
import { withEnv } from './with-env'

/**
 * Resend's delivery webhook, through the real app: a signed event lands on
 * `/api/v1/webhooks/resend` and the matching `email_log` row learns what became
 * of its message. Signed here exactly as Resend (Svix) signs — HMAC-SHA256 over
 * `id.timestamp.body` with the base64 half of the `whsec_` secret.
 */
describe('resend delivery webhook', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let outcomes!: typeof import('../services/notifications/delivery-outcomes')

  const secret = `whsec_${randomBytes(24).toString('base64')}`
  const run = Date.now().toString(36)
  const alerts: OutcomeAlert[] = []
  let restore: () => void = () => {}

  function sign(body: string, key = secret) {
    const id = `msg_${randomUUID()}`
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const raw = Buffer.from(key.replace(/^whsec_/, ''), 'base64')
    const signature = createHmac('sha256', raw).update(`${id}.${timestamp}.${body}`).digest('base64')
    return { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` }
  }

  function post(body: string, headers: Record<string, string>) {
    return harness.app.request('/api/v1/webhooks/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    })
  }

  function event(type: string, messageId: string, tags: Record<string, string>, extra: Record<string, unknown> = {}) {
    return JSON.stringify({
      type,
      created_at: new Date().toISOString(),
      data: {
        created_at: new Date().toISOString(),
        email_id: messageId,
        message_id: `<${messageId}@resend>`,
        from: 'noreply@reservetoday.app',
        to: ['someone@example.test'],
        subject: 'Probe',
        tags,
        ...extra,
      },
    })
  }

  const sendSigned = (body: string) => post(body, sign(body))
  const bounce = { bounce: { type: 'Permanent', subType: 'General', message: 'mailbox does not exist' } }

  /** A sent `email_log` row for one tenant, as the send path leaves it. */
  async function sentRow(tenantId: string) {
    const messageId = `re_${randomUUID()}`
    await harness.db.insert(schema.emailLog).values({
      tenantId,
      templateSlug: 'welcome',
      recipientEmail: `probe-${run}-${randomUUID()}@resend-webhook.test`,
      recipientUserKind: 'client',
      subjectRendered: 's',
      bodyRendered: 'b',
      status: 'sent',
      smtpMessageId: messageId,
      sentAt: new Date(),
    })
    return messageId
  }

  async function rowFor(messageId: string) {
    const [row] = await harness.db
      .select()
      .from(schema.emailLog)
      .where(eq(schema.emailLog.smtpMessageId, messageId))
    return row!
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    outcomes = await import('../services/notifications/delivery-outcomes')
    restore = outcomes.useOutcomeReporter({ alert: a => alerts.push(a) })
    process.env.RESEND_WEBHOOK_SECRET = secret
  })

  afterEach(() => {
    alerts.length = 0
    process.env.RESEND_WEBHOOK_SECRET = secret
  })

  after(async () => {
    restore()
    delete process.env.RESEND_WEBHOOK_SECRET
    await harness?.close()
  })

  test('a missing or wrong signature is refused with 400', async () => {
    const { one } = harness.tenants
    const messageId = await sentRow(one.id)
    const body = event('email.delivered', messageId, { tenant: one.id })

    assert.equal((await post(body, {})).status, 400)
    const forged = sign(body, `whsec_${randomBytes(24).toString('base64')}`)
    assert.equal((await post(body, forged)).status, 400)
    const tampered = sign(body)
    assert.equal((await post(body.replace('delivered', 'bounced'), tampered)).status, 400)

    assert.equal((await rowFor(messageId)).status, 'sent')
  })

  test('with no secret configured the route says so', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET
    const res = await post('{}', {})
    assert.equal(res.status, 500)
    assert.deepEqual(await res.json(), { error: 'webhook_not_configured' })
  })

  test("NTF-23 a bounce marks that tenant's row bounced and raises the alert", async () => {
    const { one } = harness.tenants
    const messageId = await sentRow(one.id)

    const res = await sendSigned(event('email.bounced', messageId, { tenant: one.id, template: 'welcome' }, bounce))
    assert.equal(res.status, 200)

    const row = await rowFor(messageId)
    assert.equal(row.status, 'bounced')
    assert.ok(row.outcomeAt, 'the outcome is timestamped')
    assert.deepEqual(alerts, [
      { code: 'mail_hard_bounce', tenantId: one.id, template: 'welcome', recipientKind: 'client' },
    ])
  })

  test('NTF-23 a delivery marks the row delivered, and the same event twice is harmless', async () => {
    const { two } = harness.tenants
    const messageId = await sentRow(two.id)
    const body = event('email.delivered', messageId, { tenant: two.id })

    assert.equal((await sendSigned(body)).status, 200)
    const first = await rowFor(messageId)
    assert.equal(first.status, 'delivered')

    assert.equal((await sendSigned(body)).status, 200)
    const second = await rowFor(messageId)
    assert.equal(second.status, 'delivered')
    assert.deepEqual(alerts, [])
  })

  test('a delivery arriving after a bounce does not overwrite it', async () => {
    const { one } = harness.tenants
    const messageId = await sentRow(one.id)

    await sendSigned(event('email.bounced', messageId, { tenant: one.id }, bounce))
    const res = await sendSigned(event('email.delivered', messageId, { tenant: one.id }))
    assert.equal(res.status, 200)
    assert.equal((await rowFor(messageId)).status, 'bounced')

    // And the duplicate bounce does not alert a second time.
    await sendSigned(event('email.bounced', messageId, { tenant: one.id }, bounce))
    assert.equal(alerts.length, 1)
  })

  test("an event tagged for one tenant cannot change another tenant's row", async () => {
    const { one, two } = harness.tenants
    const acmeMessage = await sentRow(two.id)

    const res = await sendSigned(event('email.complained', acmeMessage, { tenant: one.id }))
    assert.equal(res.status, 200)
    assert.equal((await rowFor(acmeMessage)).status, 'sent')
    assert.deepEqual(alerts, [])
  })

  test('an event with no tenant tag, or an unknown message id, is acknowledged and changes nothing', async () => {
    const { one } = harness.tenants
    const messageId = await sentRow(one.id)

    const untagged = await sendSigned(event('email.bounced', messageId, {}, bounce))
    assert.equal(untagged.status, 200)
    const unknown = await sendSigned(event('email.bounced', `re_${randomUUID()}`, { tenant: one.id }, bounce))
    assert.equal(unknown.status, 200)
    const garbage = await sendSigned(event('email.bounced', messageId, { tenant: 'not-a-uuid' }, bounce))
    assert.equal(garbage.status, 200)

    const row = await rowFor(messageId)
    assert.equal(row.status, 'sent')
    assert.equal(row.outcomeAt, null)
    assert.deepEqual(alerts, [])
  })

  describe('inbound mail to a ClassPass address', () => {
    withEnv({ CLASSPASS_INBOUND_DOMAIN: 'classpass-inbound.test' })
    let settings!: typeof import('../services/classpass/settings')
    let undoFetcher: () => void = () => {}
    /** What the fetcher hands back, by Resend email id. */
    const messages = new Map<string, InboundEmail>()
    const fetched: string[] = []

    before(async () => {
      settings = inTenantContext(await import('../services/classpass/settings'))
      const inbound = await import('../services/classpass/inbound')
      undoFetcher = inbound.useInboundFetcher(async emailId => {
        fetched.push(emailId)
        const message = messages.get(emailId)
        if (!message) throw new Error(`no message ${emailId}`)
        return message
      })
    })

    after(async () => {
      undoFetcher()
      for (const tenant of [harness.tenants.one, harness.tenants.two]) {
        await harness.db.delete(schema.classpassInboundEmails).where(eq(schema.classpassInboundEmails.tenantId, tenant.id))
        await harness.db.delete(schema.classpassSettings).where(eq(schema.classpassSettings.tenantId, tenant.id))
      }
    })

    /** Resend's `email.received` for a forwarded message: To: is the studio's own mailbox, the envelope names the address. */
    function received(address: string, message: InboundEmail) {
      const emailId = randomUUID()
      messages.set(emailId, message)
      return JSON.stringify({
        type: 'email.received',
        created_at: new Date().toISOString(),
        data: {
          email_id: emailId,
          created_at: new Date().toISOString(),
          from: message.from,
          to: message.to,
          received_for: [address],
          bcc: [],
          cc: [],
          message_id: message.messageId,
          subject: message.subject,
          attachments: [],
        },
      })
    }

    async function kept(tenantId: string) {
      return harness.db
        .select()
        .from(schema.classpassInboundEmails)
        .where(eq(schema.classpassInboundEmails.tenantId, tenantId))
    }

    test('CPS-16 an unsigned or badly signed email.received is refused, and nothing is fetched or kept', async () => {
      const { one } = harness.tenants
      const { address } = await settings.readClassPass(one.id)
      const before = (await kept(one.id)).length
      const body = received(address!, classPassEmail())

      assert.equal((await post(body, {})).status, 400)
      assert.equal((await post(body, sign(body, `whsec_${randomBytes(24).toString('base64')}`))).status, 400)
      assert.equal((await post(body.replace('email.received', 'email.receivedx'), sign(body))).status, 400)

      assert.deepEqual(fetched, [])
      assert.equal((await kept(one.id)).length, before)
    })

    test("CPS-17 a signed email.received is kept by the studio whose address it names, and only that studio", async () => {
      const { one, two } = harness.tenants
      const { address } = await settings.readClassPass(two.id)
      const email = classPassEmail({ location: 'Acme - Riverside' })
      const northwindBefore = (await kept(one.id)).length

      const res = await sendSigned(received(address!, email))
      assert.equal(res.status, 200)

      const rows = (await kept(two.id)).filter(r => r.messageId === email.messageId)
      assert.equal(rows.length, 1)
      assert.equal(rows[0]!.outcome, 'ignored')
      assert.equal((await kept(one.id)).length, northwindBefore)

      // Redelivered: acknowledged, and still kept once.
      assert.equal((await sendSigned(received(address!, email))).status, 200)
      assert.equal((await kept(two.id)).filter(r => r.messageId === email.messageId).length, 1)
    })

    test('CPS-17 mail to an unknown or regenerated token is acknowledged and dropped', async () => {
      const { one } = harness.tenants
      const old = (await settings.readClassPass(one.id)).address!
      await settings.regenerateClassPassAddress(one.id)
      const before = (await kept(one.id)).length
      fetched.length = 0

      const toOld = await sendSigned(received(old, classPassEmail()))
      assert.equal(toOld.status, 200)
      const toNobody = await sendSigned(received('0123456789abcdef0123456789abcdef@classpass-inbound.test', classPassEmail()))
      assert.equal(toNobody.status, 200)
      const elsewhere = await sendSigned(received('frontdesk@northwind.test', classPassEmail()))
      assert.equal(elsewhere.status, 200)

      assert.deepEqual(fetched, [])
      assert.equal((await kept(one.id)).length, before)
    })
  })

  test('a suppressed send is filed and alerts; a complaint after delivery still lands', async () => {
    const { two } = harness.tenants
    const suppressed = await sentRow(two.id)
    await sendSigned(
      event('email.suppressed', suppressed, { tenant: two.id }, { suppressed: { type: 'bounce', message: 'on list' } }),
    )
    assert.equal((await rowFor(suppressed)).status, 'suppressed')

    const complained = await sentRow(two.id)
    await sendSigned(event('email.delivered', complained, { tenant: two.id }))
    await sendSigned(event('email.complained', complained, { tenant: two.id }))
    assert.equal((await rowFor(complained)).status, 'complained')

    assert.deepEqual(
      alerts.map(a => a.code),
      ['mail_suppressed', 'mail_complaint'],
    )
  })
})
