/**
 * A restricted key is a secret key of its mode too (#294). Whether it may set
 * up the studio's webhook is the provider's to answer — a key refused here as
 * the "wrong mode" would never get as far as the refusal that names the
 * permission it lacks.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { keyModeMatches } from './provider-setup'

describe('a restricted key and the environment’s key mode', () => {
  test('PAY-35 production takes a live restricted key and refuses a test one', () => {
    assert.equal(keyModeMatches('rk_live_abc', 'production'), true)
    assert.equal(keyModeMatches('rk_test_abc', 'production'), false)
  })

  test('PAY-35 staging and development take a test restricted key and refuse a live one', () => {
    for (const appEnv of ['staging', 'development'] as const) {
      assert.equal(keyModeMatches('rk_test_abc', appEnv), true)
      assert.equal(keyModeMatches('rk_live_abc', appEnv), false)
    }
  })
})
