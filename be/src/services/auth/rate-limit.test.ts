import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { AUTH_RATE_LIMITS, authRateLimit, authRateLimitStorage } from './rate-limit'

describe('auth rate limits', () => {
  test('a budget is spent, refused with the time left, and refilled by the next window', async () => {
    let now = 1_000_000
    const storage = authRateLimitStorage(() => now)
    const rule = { window: 60, max: 2 }

    assert.deepEqual(await storage.consume('1.2.3.4|/sign-in/email-otp', rule), { allowed: true, retryAfter: null })
    assert.deepEqual(await storage.consume('1.2.3.4|/sign-in/email-otp', rule), { allowed: true, retryAfter: null })
    now += 15_000
    assert.deepEqual(await storage.consume('1.2.3.4|/sign-in/email-otp', rule), { allowed: false, retryAfter: 45 })

    now += 45_000
    assert.deepEqual(await storage.consume('1.2.3.4|/sign-in/email-otp', rule), { allowed: true, retryAfter: null })
  })

  test('a refused request does not push the window out', async () => {
    let now = 0
    const storage = authRateLimitStorage(() => now)
    const rule = { window: 10, max: 1 }
    await storage.consume('k', rule)
    for (let i = 0; i < 5; i++) {
      now += 1_000
      assert.equal((await storage.consume('k', rule)).allowed, false)
    }
    now = 10_000
    assert.equal((await storage.consume('k', rule)).allowed, true)
  })

  test('addresses and paths have their own budgets', async () => {
    const storage = authRateLimitStorage(() => 0)
    const rule = { window: 60, max: 1 }
    assert.equal((await storage.consume('1.1.1.1|/sign-in/email-otp', rule)).allowed, true)
    assert.equal((await storage.consume('2.2.2.2|/sign-in/email-otp', rule)).allowed, true)
    assert.equal((await storage.consume('1.1.1.1|/email-otp/send-verification-otp', rule)).allowed, true)
  })

  test('two pools never share a budget, though Better Auth names their paths alike', async () => {
    // The limiter keys on `ip|path` with the path relative to each pool's base
    // path, so the staff and platform `/sign-in/email` are the same key.
    const rule = { window: 60, max: 1 }
    const staff = authRateLimit().customStorage
    const platform = authRateLimit().customStorage
    assert.equal((await staff.consume('1.1.1.1|/sign-in/email', rule)).allowed, true)
    assert.equal((await platform.consume('1.1.1.1|/sign-in/email', rule)).allowed, true)
    assert.equal((await staff.consume('1.1.1.1|/sign-in/email', rule)).allowed, false)
  })

  test('every sign-in attempt and every code request on a pool is on a named budget', () => {
    const { enabled, customRules } = authRateLimit()
    assert.equal(enabled, true, 'on in every environment, not only production')
    for (const path of ['/email-otp/send-verification-otp', '/two-factor/send-otp']) {
      assert.deepEqual(customRules[path], AUTH_RATE_LIMITS.codeRequest, path)
    }
    for (const path of [
      '/sign-in/email',
      '/sign-in/email-otp',
      '/email-otp/check-verification-otp',
      '/email-otp/verify-email',
      '/two-factor/verify-otp',
      '/two-factor/verify-totp',
      '/two-factor/verify-backup-code',
    ]) {
      assert.deepEqual(customRules[path], AUTH_RATE_LIMITS.signInAttempt, path)
    }
  })
})
