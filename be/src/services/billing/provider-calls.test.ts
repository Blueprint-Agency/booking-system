/**
 * The billing paths that touch the payment provider, driven through the fake.
 *
 * These had no tests at all before the accessor existed, for the ordinary
 * reason: every one of them reached a module-level client that could only be
 * silenced by intercepting the network. With one Tenant-bound accessor they are
 * plain function calls, and this file asserts what each of them actually sends.
 *
 * Nothing here touches the database. The provider is the only collaborator
 * these particular functions have.
 */
import assert from 'node:assert/strict'
import { before, afterEach, describe, test } from 'node:test'

// Set before anything imports `env` or `../../db`: both read the environment at
// module load, so the modules under test are pulled in dynamically below.
process.env.STRIPE_STATEMENT_DESCRIPTOR_PREFIX = 'RSVT'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_provider_calls_test'
// A placeholder, never dialled: postgres-js connects lazily and nothing in this
// file reaches the database.
process.env.DATABASE_APP_URL ||= 'postgres://booking_app:none@127.0.0.1:5432/none'

const TENANT = '11111111-1111-4111-8111-111111111111'
const CLIENT = '33333333-3333-4333-8333-333333333333'

type Billing = {
  checkoutSessionParams: typeof import('./checkout-session').checkoutSessionParams
  refundAtProvider: typeof import('./refunds').refundAtProvider
  receiptUrlPatch: typeof import('./webhook-handler').receiptUrlPatch
  installStripeFake: typeof import('../../test/stripe-fake').installStripeFake
  setStripeFactory: typeof import('../../lib/stripe').setStripeFactory
  webhookRoute: typeof import('../../routes/webhooks/stripe').default
}

let billing: Billing

before(async () => {
  const [checkout, refunds, webhook, fake, lib, route] = await Promise.all([
    import('./checkout-session'),
    import('./refunds'),
    import('./webhook-handler'),
    import('../../test/stripe-fake'),
    import('../../lib/stripe'),
    import('../../routes/webhooks/stripe'),
  ])
  billing = {
    checkoutSessionParams: checkout.checkoutSessionParams,
    refundAtProvider: refunds.refundAtProvider,
    receiptUrlPatch: webhook.receiptUrlPatch,
    installStripeFake: fake.installStripeFake,
    setStripeFactory: lib.setStripeFactory,
    webhookRoute: route.default,
  }
})

afterEach(() => billing.setStripeFactory(null))

const input = (over: Partial<Parameters<Billing['checkoutSessionParams']>[0]> = {}) => ({
  tenantId: TENANT,
  email: 'member@example.test',
  lines: [{ name: 'Unlimited 3 Months', description: 'Acme Yoga', amountCents: 50000 }],
  expiresAt: null,
  metadata: { kind: 'class_package', client_id: CLIENT },
  successUrl: 'https://acme.example.test/ok',
  cancelUrl: 'https://acme.example.test/no',
  ...over,
})

describe('the checkout session a purchase asks for', () => {
  test('the studio is stamped on the session AND on the intent', () => {
    const params = billing.checkoutSessionParams(input(), 'Acme Yoga')
    assert.equal(params.metadata?.tenant_id, TENANT)
    // The intent is what a refund, a dispute and a bank statement point at, so
    // the studio has to be readable from it without the session.
    assert.deepEqual(params.payment_intent_data?.metadata, {
      tenant_id: TENANT,
      client_id: CLIENT,
    })
  })

  test("the studio's name rides on the card statement", () => {
    const params = billing.checkoutSessionParams(input(), 'Acme Yoga')
    assert.equal(params.payment_intent_data?.statement_descriptor_suffix, 'Acme Yoga')
  })

  test('a name that cannot be sent safely is left off rather than refused', () => {
    const params = billing.checkoutSessionParams(input(), '***')
    assert.ok(!('statement_descriptor_suffix' in (params.payment_intent_data ?? {})))
  })

  test('every line is one quantity of its own price, in the platform currency', () => {
    const params = billing.checkoutSessionParams(
      input({
        lines: [
          { name: 'Plan', description: 'Acme Yoga', amountCents: 50000 },
          { name: 'Cross-Location Add-On', description: 'Acme Yoga', amountCents: 9000 },
        ],
      }),
      'Acme Yoga',
    )
    assert.deepEqual(
      params.line_items?.map(item => [item.price_data?.unit_amount, item.quantity]),
      [
        [50000, 1],
        [9000, 1],
      ],
    )
    assert.ok(params.line_items?.every(item => item.price_data?.currency === 'sgd'))
  })

  test("a capped Promo Code's Hold expires the session with it", () => {
    const expiresAt = new Date('2026-09-07T12:00:00Z')
    const params = billing.checkoutSessionParams(input({ expiresAt }), 'Acme Yoga')
    assert.equal(params.expires_at, Math.floor(expiresAt.getTime() / 1000))
  })

  test("no Hold leaves Stripe's own expiry alone", () => {
    assert.ok(!('expires_at' in billing.checkoutSessionParams(input(), 'Acme Yoga')))
  })
})

describe('the refund call', () => {
  test('the intent is refunded whole, on the studio it was taken on', async () => {
    const fake = billing.installStripeFake()
    fake.reply('refunds.create', {})

    await billing.refundAtProvider(TENANT, 'pi_123')

    const [call] = fake.callsTo('refunds.create')
    assert.deepEqual(call?.args[0], { payment_intent: 'pi_123' })
    assert.equal(call?.account, null)
  })

  test('the intent is the idempotency key — a double-click cannot refund twice', async () => {
    const fake = billing.installStripeFake()
    fake.reply('refunds.create', {})

    await billing.refundAtProvider(TENANT, 'pi_123')
    await billing.refundAtProvider(TENANT, 'pi_123')

    const keys = fake.callsTo('refunds.create').map(call => call.args[1])
    assert.deepEqual(keys, [
      { idempotencyKey: 'refund:pi_123' },
      { idempotencyKey: 'refund:pi_123' },
    ])
  })

  test('a provider refusal reaches the caller — the audit row must not be written', async () => {
    const fake = billing.installStripeFake()
    fake.reply('refunds.create', new Error('charge_already_refunded'))

    await assert.rejects(() => billing.refundAtProvider(TENANT, 'pi_123'), /already_refunded/)
  })
})

describe("the webhook's receipt lookup", () => {
  test('the receipt is read off the latest charge, which must be expanded', async () => {
    const fake = billing.installStripeFake()
    fake.reply('paymentIntents.retrieve', {
      latest_charge: { receipt_url: 'https://pay.example.test/r/1' },
    })

    const patch = await billing.receiptUrlPatch(TENANT, 'pi_123')

    assert.deepEqual(patch, { receiptUrl: 'https://pay.example.test/r/1' })
    assert.deepEqual(fake.callsTo('paymentIntents.retrieve')[0]?.args, [
      'pi_123',
      { expand: ['latest_charge'] },
    ])
  })

  test('an unexpanded charge leaves the column absent, not blanked', async () => {
    const fake = billing.installStripeFake()
    fake.reply('paymentIntents.retrieve', { latest_charge: 'ch_123' })

    assert.deepEqual(await billing.receiptUrlPatch(TENANT, 'pi_123'), {})
  })

  test('a provider failure never fails a purchase that was already delivered', async () => {
    const fake = billing.installStripeFake()
    fake.reply('paymentIntents.retrieve', new Error('provider down'))

    assert.deepEqual(await billing.receiptUrlPatch(TENANT, 'pi_123'), {})
  })
})

describe("the webhook's signature check", () => {
  const post = (body: string, signature?: string) =>
    billing.webhookRoute.request('/stripe', {
      method: 'POST',
      body,
      headers: signature ? { 'stripe-signature': signature } : {},
    })

  test('the signature is checked on the platform, before anything names a studio', async () => {
    const fake = billing.installStripeFake()
    // Refused, so the handler below is never reached and no database is needed.
    fake.reply('webhooks.constructEvent', new Error('no signatures found'))

    const response = await post('{"id":"evt_1"}', 't=1,v1=deadbeef')

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'invalid_webhook_signature' })
    const [call] = fake.callsTo('webhooks.constructEvent')
    assert.equal(call?.account, null)
    assert.deepEqual(call?.args.slice(0, 2), ['{"id":"evt_1"}', 't=1,v1=deadbeef'])
  })

  test('a body arriving with no signature at all is refused the same way', async () => {
    const fake = billing.installStripeFake()
    fake.reply('webhooks.constructEvent', new Error('no signatures found'))

    assert.equal((await post('{"id":"evt_1"}')).status, 400)
    assert.equal(fake.callsTo('webhooks.constructEvent')[0]?.args[1], '')
  })

  test('an event the provider vouches for is handed on, and acknowledged', async () => {
    const fake = billing.installStripeFake()
    // A type the handler dispatches on and does nothing with, so the
    // acknowledgement is asserted without reaching the database.
    fake.reply('webhooks.constructEvent', { id: 'evt_1', type: 'payment_intent.created' })

    const response = await post('{"id":"evt_1"}', 't=1,v1=good')

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { received: true })
  })
})
