/**
 * The test suite must never reach smtp.gmail.com.
 *
 * `.env` carries the platform's real Gmail credentials, and the harness only
 * filled in `SMTP_*` when they were *unset* — so every templated email a test
 * triggered was really sent, to `@example.test` / `@isolation.test` addresses
 * that cannot exist, and each one bounced back into the platform inbox.
 *
 * Asserted on the transport rather than on a send, because the behavioural
 * version of this test would have to send a message to find out — which is the
 * exact thing it exists to prevent. And asserted *positively*: `not SMTP`
 * would pass silently the day nodemailer changes the shape read here, which is
 * the same false green that let this ship.
 *
 * It goes through `startTestApp` for its environment because `stubEnvironment`
 * is the one door into a valid one, and a test that stubbed its own copy would
 * stop testing the harness the rest of the suite actually runs under.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { integrationTestsEnabled, SKIP_REASON, startTestApp } from './harness'

/** Nodemailer names its built-in transports; `SMTP` is the one that delivers. */
function transportName(transporter: unknown): string | undefined {
  const inner = (transporter as { transporter?: { name?: unknown } }).transporter
  return typeof inner?.name === 'string' ? inner.name : undefined
}

test(
  'the mailer under test is not a live SMTP transport',
  { skip: !integrationTestsEnabled && SKIP_REASON },
  async () => {
    const app = await startTestApp()
    try {
      const { transporter } = await import('../lib/mailer')
      assert.equal(
        transportName(transporter),
        'JSONTransport',
        'tests must not be able to deliver mail — see lib/mailer.ts',
      )
    } finally {
      await app.close()
    }
  },
)
