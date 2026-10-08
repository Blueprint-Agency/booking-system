import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { ResendClient, ResendPayload } from '../lib/send-gate'

/**
 * A studio's email can carry files: the groundwork for a purchase confirmation
 * that attaches its Receipt PDF (#380, #381). Sent through the one way a
 * studio's mail leaves, `sendTemplatedEmail`, and read back at the two ends a
 * message can reach: the null transport's capture under test, and the Resend
 * client the live transport hands its payload to.
 */
describe('mail attachments', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let mailer!: typeof import('../lib/mailer')
  let send!: typeof import('../services/notifications/send')
  let withTenant!: typeof import('../db')['withTenant']

  const run = Date.now().toString(36)
  const at = (name: string) => `${name}-${run}@attachments.test`

  // Not valid UTF-8 on purpose: bytes that survive a text round trip by luck
  // would not prove the content went through untouched.
  const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff, 0x80, 0xc3, 0x28])

  before(async () => {
    harness = await startTestApp()
    mailer = await import('../lib/mailer')
    send = await import('../services/notifications/send')
    ;({ withTenant } = await import('../db'))
  })

  after(async () => {
    await harness?.close()
  })

  const sendWelcome = (email: string, attachments?: { filename: string; contentType: string; content: Buffer }[]) => {
    const { one } = harness.tenants
    return withTenant(one.id, () =>
      send.sendTemplatedEmail({
        tenantId: one.id,
        slug: 'welcome',
        recipient: { email, userKind: 'client' },
        variables: { name: 'Probe' },
        ...(attachments ? { attachments } : {}),
      }),
    )
  }

  test('the test mail capture records each attachment with its filename, content type and bytes', async () => {
    const email = at('captured')
    await sendWelcome(email, [
      { filename: 'R-000123.pdf', contentType: 'application/pdf', content: pdfBytes },
      { filename: 'notes.txt', contentType: 'text/plain', content: Buffer.from('second file') },
    ])

    const [captured] = mailer.discardedMail.filter(m => m.to === email)
    assert.ok(captured, 'the message reached the transport')
    assert.equal(captured.attachments?.length, 2)
    const [pdf, notes] = captured.attachments!
    assert.equal(pdf!.filename, 'R-000123.pdf')
    assert.equal(pdf!.contentType, 'application/pdf')
    assert.ok(Buffer.from(pdf!.content).equals(pdfBytes), 'the bytes arrive exactly as sent')
    assert.equal(notes!.filename, 'notes.txt')
    assert.equal(notes!.contentType, 'text/plain')
    assert.equal(Buffer.from(notes!.content).toString('utf8'), 'second file')
  })

  describe('through the Resend transport', () => {
    const calls: ResendPayload[] = []
    const client: ResendClient = {
      async send(payload) {
        calls.push(payload)
        return { data: { id: `fake-${calls.length}` }, error: null, headers: {} }
      },
    }
    let restore: () => void = () => {}

    before(() => {
      restore = mailer.useTransport(
        mailer.createResendTransport(client, { report: { warn: () => {}, alert: () => {}, usage: () => {} } }),
      )
    })
    after(() => restore())

    test('each attachment reaches Resend as base64 content with its filename and content type', async () => {
      const email = at('resend')
      await sendWelcome(email, [{ filename: 'R-000123.pdf', contentType: 'application/pdf', content: pdfBytes }])

      const payload = calls.find(c => c.to === email)
      assert.ok(payload, 'the message reached Resend')
      assert.deepEqual(payload.attachments, [
        { filename: 'R-000123.pdf', contentType: 'application/pdf', content: pdfBytes.toString('base64') },
      ])
      // Decoded the way Resend decodes it, the file is the one that was sent.
      assert.ok(Buffer.from(payload.attachments![0]!.content, 'base64').equals(pdfBytes))
    })

    test('an email sent with no attachments, or an empty list, reaches Resend with no attachments field', async () => {
      const without = at('resend-none')
      const empty = at('resend-empty')
      await sendWelcome(without)
      await sendWelcome(empty, [])

      for (const email of [without, empty]) {
        const payload = calls.find(c => c.to === email)
        assert.ok(payload, 'the message reached Resend')
        assert.equal('attachments' in payload, false, email)
      }
    })
  })
})
