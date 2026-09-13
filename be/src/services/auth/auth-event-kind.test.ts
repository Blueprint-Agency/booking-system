import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { authEventKind } from './auth-event-kind'

const step = (path: string, outcome: { failed?: boolean; signedIn?: boolean; hadSession?: boolean } = {}) =>
  authEventKind({
    path,
    failed: outcome.failed ?? false,
    newSession: outcome.signedIn ?? false,
    hadSession: outcome.hadSession ?? false,
  })

describe('which auth event a request is', () => {
  test('a request that ends holding a new session is a sign-in, however it got there', () => {
    assert.equal(step('/sign-in/email-otp', { signedIn: true }), 'sign_in')
    assert.equal(step('/sign-in/email', { signedIn: true }), 'sign_in')
    assert.equal(step('/two-factor/verify-otp', { signedIn: true }), 'sign_in')
    assert.equal(step('/two-factor/verify-totp', { signedIn: true }), 'sign_in')
    assert.equal(step('/two-factor/verify-backup-code', { signedIn: true }), 'sign_in')
  })

  test('a password that is right but still owes a second factor is nothing yet', () => {
    // The two-factor plugin deletes the half-made session before this is asked.
    assert.equal(step('/sign-in/email'), null)
  })

  test('a session rotated for someone already in is not a sign-in', () => {
    // Enabling two-factor, and confirming the authenticator app after, both
    // replace the session of a person who was signed in all along.
    assert.equal(step('/two-factor/enable', { signedIn: true, hadSession: true }), null)
    assert.equal(step('/two-factor/verify-totp', { signedIn: true, hadSession: true }), null)
  })

  test('a refused password is a failed sign-in', () => {
    assert.equal(step('/sign-in/email', { failed: true }), 'sign_in_failed')
  })

  test('a refused one-time code is a failed code, on either pool', () => {
    for (const path of [
      '/sign-in/email-otp',
      '/email-otp/check-verification-otp',
      '/email-otp/verify-email',
      '/two-factor/verify-otp',
      '/two-factor/verify-totp',
      '/two-factor/verify-backup-code',
    ]) {
      assert.equal(step(path, { failed: true }), 'code_failed', path)
    }
  })

  test('a code that went out is a code sent; one refused before it went out is not', () => {
    assert.equal(step('/email-otp/send-verification-otp'), 'code_sent')
    assert.equal(step('/two-factor/send-otp'), 'code_sent')
    assert.equal(step('/email-otp/send-verification-otp', { failed: true }), null)
  })

  test('everything else is not audited', () => {
    assert.equal(step('/get-session'), null)
    assert.equal(step('/ok'), null)
    assert.equal(step('/request-password-reset'), null)
    assert.equal(step('/sign-up/email', { failed: true }), null)
  })
})
