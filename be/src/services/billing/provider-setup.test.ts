/**
 * Setting a studio's own payment credentials can't be done wrongly (#276): the
 * environment decides which kind of key it takes, and the webhook URL the
 * operator is shown is HTTPS wherever the provider will call it.
 *
 * Nothing here touches the database. The mode guard runs before the provider is
 * asked and before anything is stored, and the service tests below prove that
 * by having no database to store into.
 */
import assert from 'node:assert/strict'
import { afterEach, before, describe, test } from 'node:test'

// Set before anything imports `env`: it reads the environment at module load.
// A placeholder database, never dialled — postgres-js connects lazily.
process.env.DATABASE_APP_URL ||= 'postgres://booking_app:none@127.0.0.1:5432/none'
// A well-formed sealing key, so the guard under test is the one that answers.
process.env.PAYMENT_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64')

import {
  expectedKeyPrefix,
  keyModeMatches,
  PROVIDER_WEBHOOK_EVENTS,
  providerWebhookUrl,
} from './provider-setup'

const TENANT = '11111111-1111-4111-8111-111111111111'

describe('the kind of key an environment takes', () => {
  test('production takes only live keys', () => {
    assert.equal(expectedKeyPrefix('production'), 'sk_live_')
    assert.equal(keyModeMatches('sk_live_abc', 'production'), true)
    assert.equal(keyModeMatches('sk_test_abc', 'production'), false)
  })

  test('staging takes only test keys', () => {
    assert.equal(expectedKeyPrefix('staging'), 'sk_test_')
    assert.equal(keyModeMatches('sk_test_abc', 'staging'), true)
    assert.equal(keyModeMatches('sk_live_abc', 'staging'), false)
  })

  test('development takes only test keys', () => {
    assert.equal(keyModeMatches('sk_test_abc', 'development'), true)
    assert.equal(keyModeMatches('sk_live_abc', 'development'), false)
  })

  test('a key that is neither is refused everywhere', () => {
    for (const appEnv of ['development', 'staging', 'production'] as const) {
      assert.equal(keyModeMatches('pk_live_abc', appEnv), false)
      assert.equal(keyModeMatches('whsec_abc', appEnv), false)
    }
  })
})

describe('the webhook URL a studio is shown', () => {
  test('is HTTPS on staging and production even when configured as http', () => {
    for (const appEnv of ['staging', 'production'] as const) {
      assert.equal(
        providerWebhookUrl('http://api.example.test', 'northwind', appEnv),
        'https://api.example.test/api/v1/webhooks/stripe/northwind',
      )
      assert.equal(
        providerWebhookUrl('https://api.example.test', 'northwind', appEnv),
        'https://api.example.test/api/v1/webhooks/stripe/northwind',
      )
    }
  })

  test('keeps the configured scheme in development, where there is no TLS', () => {
    assert.equal(
      providerWebhookUrl('http://localhost:4000', 'acme', 'development'),
      'http://localhost:4000/api/v1/webhooks/stripe/acme',
    )
  })

  test('names the two events the handler acts on', () => {
    assert.deepEqual([...PROVIDER_WEBHOOK_EVENTS], ['checkout.session.completed', 'charge.refunded'])
  })
})

describe('saving a key of the wrong mode', () => {
  let onboarding!: typeof import('./provider-onboarding')
  let stripe!: typeof import('../../lib/stripe')
  // The guard reads APP_ENV when it runs (`currentEnv`), not off the `env`
  // object loaded at import, so the environment itself is what a test sets.
  let originalAppEnv: string | undefined
  let providerAsked = 0

  before(async () => {
    ;[onboarding, stripe] = await Promise.all([import('./provider-onboarding'), import('../../lib/stripe')])
    originalAppEnv = process.env.APP_ENV
  })

  afterEach(() => {
    if (originalAppEnv === undefined) delete process.env.APP_ENV
    else process.env.APP_ENV = originalAppEnv
    stripe.setStripeFactory(null)
  })

  /** A provider that counts being asked and then refuses the key. */
  function refusingProvider() {
    providerAsked = 0
    stripe.setStripeFactory((() => ({
      accounts: {
        retrieve: async () => {
          providerAsked++
          throw new Error('no such key')
        },
      },
    })) as unknown as import('../../lib/stripe').StripeFactory)
  }

  const attempt = (secretKey: string) =>
    onboarding.configureProviderAccount(TENANT, { secretKey })

  const refusedAs = async (secretKey: string, reason: string) => {
    await assert.rejects(attempt(secretKey), (err: unknown) => {
      assert.ok(err instanceof onboarding.ProviderOnboardingError)
      assert.equal(err.reason, reason)
      return true
    })
  }

  for (const [appEnv, wrong, right, prefix] of [
    ['staging', 'sk_live_abc', 'sk_test_abc', 'sk_test_'],
    ['production', 'sk_test_abc', 'sk_live_abc', 'sk_live_'],
  ] as const) {
    test(`on ${appEnv}, a ${wrong.slice(0, 8)} key is refused before the provider is asked`, async () => {
      process.env.APP_ENV = appEnv
      refusingProvider()
      await assert.rejects(attempt(wrong), (err: unknown) => {
        assert.ok(err instanceof onboarding.ProviderOnboardingError)
        assert.equal(err.reason, 'key_wrong_mode')
        assert.match(err.message, new RegExp(prefix))
        return true
      })
      // Refused before the provider and before the store: had it reached the
      // store, this file's undialled database would have failed differently.
      assert.equal(providerAsked, 0)
    })

    test(`on ${appEnv}, a ${right.slice(0, 8)} key goes on to the provider`, async () => {
      process.env.APP_ENV = appEnv
      refusingProvider()
      await refusedAs(right, 'key_rejected')
      assert.equal(providerAsked, 1)
    })
  }
})
