/**
 * The test suite must never reach Resend.
 *
 * `.env` carries the platform's live API key, and the harness only fills in
 * `RESEND_API_KEY` when it is *unset* — so without a guard every templated
 * email a test triggered would really be sent, to `@example.test` /
 * `@isolation.test` addresses that cannot exist, and each one would bounce
 * back into the platform inbox.
 *
 * Asserted on the transport rather than on a send, because the behavioural
 * version of this test would have to send a message to find out — which is the
 * exact thing it exists to prevent. And asserted *positively*: `not resend`
 * would pass silently the day a third transport is added, which is the same
 * false green that let the SMTP version of this ship.
 *
 * It goes through `startTestApp` for its environment because `stubEnvironment`
 * is the one door into a valid one, and a test that stubbed its own copy would
 * stop testing the harness the rest of the suite actually runs under.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { integrationTestsEnabled, SKIP_REASON, startTestApp } from './harness'

// Set before the mailer is ever imported — it reads env once, at module load,
// and the module is shared by every test in this file. `.env` is loaded by the
// harness without overriding, so these win over whatever it holds.
process.env.MAIL_FROM_EMAIL = 'hello@example.test'
process.env.MAIL_FROM_PORTAL_EMAIL = 'portal@example.test'

test(
  'the mailer under test is not a live transport',
  { skip: !integrationTestsEnabled && SKIP_REASON },
  async () => {
    const app = await startTestApp()
    try {
      const { transport } = await import('../lib/mailer')
      assert.equal(
        transport.name,
        'null',
        'tests must not be able to deliver mail — see lib/mailer.ts',
      )
    } finally {
      await app.close()
    }
  },
)

test(
  'a member and a staff member are written to from different addresses',
  { skip: !integrationTestsEnabled && SKIP_REASON },
  async () => {
    const app = await startTestApp()
    try {
      const { PLATFORM_MAIL_FROM_EMAIL } = await import('../lib/mailer')
      assert.equal(PLATFORM_MAIL_FROM_EMAIL.client, 'hello@example.test')
      assert.equal(PLATFORM_MAIL_FROM_EMAIL.staff, 'portal@example.test')
    } finally {
      await app.close()
    }
  },
)
