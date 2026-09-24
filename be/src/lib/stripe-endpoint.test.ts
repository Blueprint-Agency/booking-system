import assert from 'node:assert'
import { describe, test } from 'node:test'
import { stripeEndpoint } from './stripe-endpoint'

describe('where the payment provider is reached', () => {
  test('unset is Stripe itself: the client is given no host at all', () => {
    assert.deepEqual(stripeEndpoint(undefined, 'staging'), {})
    assert.deepEqual(stripeEndpoint('', 'production'), {})
  })

  test('a stand-in is reached at its host, port and scheme', () => {
    assert.deepEqual(stripeEndpoint('http://localhost:12111', 'development'), {
      host: 'localhost',
      port: 12111,
      protocol: 'http',
    })
  })

  test('a stand-in without a port is reached on its scheme’s own', () => {
    assert.deepEqual(stripeEndpoint('https://stripe.internal', 'staging'), {
      host: 'stripe.internal',
      port: 443,
      protocol: 'https',
    })
    assert.deepEqual(stripeEndpoint('http://stripe.internal', 'staging').port, 80)
  })

  test('production refuses a stand-in: a checkout there must take real money', () => {
    assert.throws(() => stripeEndpoint('http://localhost:12111', 'production'), /STRIPE_API_URL/)
  })

  test('anything but an http(s) origin is refused rather than half-applied', () => {
    assert.throws(() => stripeEndpoint('localhost:12111', 'development'), /STRIPE_API_URL/)
    assert.throws(() => stripeEndpoint('ftp://localhost', 'development'), /STRIPE_API_URL/)
    assert.throws(() => stripeEndpoint('http://localhost:12111/v1', 'development'), /STRIPE_API_URL/)
  })
})
