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
  setProviderCredentialsLoader: typeof import('./provider-credentials').setProviderCredentialsLoader
  webhookRoute: typeof import('../../routes/webhooks/stripe').default
  refuseWrongTenant: typeof import('./webhook-handler').refuseWrongTenant
}

let billing: Billing

before(async () => {
  const [checkout, refunds, webhook, fake, lib, route, credentials] = await Promise.all([
    import('./checkout-session'),
    import('./refunds'),
    import('./webhook-handler'),
    import('../../test/stripe-fake'),
    import('../../lib/stripe'),
    import('../../routes/webhooks/stripe'),
    import('./provider-credentials'),
  ])
  billing = {
    checkoutSessionParams: checkout.checkoutSessionParams,
    refundAtProvider: refunds.refundAtProvider,
    receiptUrlPatch: webhook.receiptUrlPatch,
    refuseWrongTenant: webhook.refuseWrongTenant,
    installStripeFake: fake.installStripeFake,
    setStripeFactory: lib.setStripeFactory,
    setProviderCredentialsLoader: credentials.setProviderCredentialsLoader,
    webhookRoute: route.default,
  }
})

// Both halves of the seam. Since #100 the accessor asks which account a call is
// on before it makes one, and leaving that on the real lookup would send this
// file — which deliberately has no database — to Postgres.
afterEach(() => {
  billing.setStripeFactory(null)
  billing.setProviderCredentialsLoader(null)
})

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

  test("a studio charging on its own account sends no suffix at all", () => {
    // The statement already says the studio's name, and the 22-character limit
    // is measured against that account's own prefix — which this platform does
    // not know. A refused charge costs the sale; a missing suffix costs a
    // nicety.
    const params = billing.checkoutSessionParams(input(), 'Acme Yoga', true)
    assert.ok(!('statement_descriptor_suffix' in (params.payment_intent_data ?? {})))
    // Still stamped with the studio, because a refund and a dispute point here.
    assert.equal(params.payment_intent_data?.metadata?.tenant_id, TENANT)
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
  test('the intent is refunded whole, on the platform account when that is where it was taken', async () => {
    const fake = billing.installStripeFake()
    fake.reply('refunds.create', {})

    await billing.refundAtProvider(TENANT, 'pi_123', null)

    const [call] = fake.callsTo('refunds.create')
    assert.deepEqual(call?.args[0], { payment_intent: 'pi_123' })
    assert.equal(call?.account, null)
  })

  test("a payment taken on the studio's own account is returned there", async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('refunds.create', {})

    await billing.refundAtProvider(TENANT, 'pi_new', 'acct_studio')

    assert.equal(fake.callsTo('refunds.create')[0]?.account, 'acct_studio')
  })

  /**
   * The migration, in one assertion (#97). The studio is on its own account
   * now; this payment was taken before it moved. Reading the studio's *current*
   * credentials would send the refund to an account where the intent does not
   * exist — the member gets nothing back and the error names an id that looks
   * right.
   */
  test('a payment taken before the studio moved is still returned on the platform account', async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('refunds.create', {})

    await billing.refundAtProvider(TENANT, 'pi_old', null)

    assert.equal(fake.callsTo('refunds.create')[0]?.account, null)
  })

  test('one Purchase straddling the move returns each payment where it came in', async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('refunds.create', {})

    await billing.refundAtProvider(TENANT, 'pi_before', null)
    await billing.refundAtProvider(TENANT, 'pi_after', 'acct_studio')

    assert.deepEqual(
      fake.callsTo('refunds.create').map(call => [call.account, call.args[0]]),
      [
        [null, { payment_intent: 'pi_before' }],
        ['acct_studio', { payment_intent: 'pi_after' }],
      ],
    )
  })

  test('an account this platform holds no key for is refused rather than sent elsewhere', async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('refunds.create', {})

    await assert.rejects(
      () => billing.refundAtProvider(TENANT, 'pi_123', 'acct_someone_else'),
      /no credentials held for provider account acct_someone_else/,
    )
    assert.deepEqual(fake.callsTo('refunds.create'), [])
  })

  test('the intent is the idempotency key — a double-click cannot refund twice', async () => {
    const fake = billing.installStripeFake()
    fake.reply('refunds.create', {})

    await billing.refundAtProvider(TENANT, 'pi_123', null)
    await billing.refundAtProvider(TENANT, 'pi_123', null)

    const keys = fake.callsTo('refunds.create').map(call => call.args[1])
    assert.deepEqual(keys, [
      { idempotencyKey: 'refund:pi_123' },
      { idempotencyKey: 'refund:pi_123' },
    ])
  })

  test('the key is per payment, so two cards on one Purchase are two refunds', async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('refunds.create', {})

    await billing.refundAtProvider(TENANT, 'pi_first', 'acct_studio')
    await billing.refundAtProvider(TENANT, 'pi_second', 'acct_studio')

    assert.deepEqual(
      fake.callsTo('refunds.create').map(call => call.args[1]),
      [{ idempotencyKey: 'refund:pi_first' }, { idempotencyKey: 'refund:pi_second' }],
    )
  })

  test('a provider refusal reaches the caller — the audit row must not be written', async () => {
    const fake = billing.installStripeFake()
    fake.reply('refunds.create', new Error('charge_already_refunded'))

    await assert.rejects(() => billing.refundAtProvider(TENANT, 'pi_123', null), /already_refunded/)
  })
})

describe("the webhook's receipt lookup", () => {
  test('the receipt is read off the latest charge, which must be expanded', async () => {
    const fake = billing.installStripeFake()
    fake.reply('paymentIntents.retrieve', {
      latest_charge: { receipt_url: 'https://pay.example.test/r/1' },
    })

    const patch = await billing.receiptUrlPatch(TENANT, 'pi_123', null)

    assert.deepEqual(patch, { receiptUrl: 'https://pay.example.test/r/1' })
    assert.deepEqual(fake.callsTo('paymentIntents.retrieve')[0]?.args, [
      'pi_123',
      { expand: ['latest_charge'] },
    ])
  })

  test('an unexpanded charge leaves the column absent, not blanked', async () => {
    const fake = billing.installStripeFake()
    fake.reply('paymentIntents.retrieve', { latest_charge: 'ch_123' })

    assert.deepEqual(await billing.receiptUrlPatch(TENANT, 'pi_123', null), {})
  })

  test('a provider failure never fails a purchase that was already delivered', async () => {
    const fake = billing.installStripeFake()
    fake.reply('paymentIntents.retrieve', new Error('provider down'))

    assert.deepEqual(await billing.receiptUrlPatch(TENANT, 'pi_123', null), {})
  })
})

describe('an event that arrived on one studio’s endpoint and names another', () => {
  const OTHER = '44444444-4444-4444-8444-444444444444'
  const refuse = (named: string | null, expected?: string) =>
    billing.refuseWrongTenant(named, expected, { eventType: 'charge.refunded' })

  test('it is refused, whatever the event type', () => {
    // A studio holds its own signing secret, so a delivery naming its
    // neighbour's payment is one it could have minted itself. Without this,
    // that secret would unwind another studio's purchase and entitlements.
    assert.throws(() => refuse(OTHER, TENANT), /webhook_tenant_mismatch/)
  })

  test('an event naming the studio it arrived at is allowed through', () => {
    assert.doesNotThrow(() => refuse(TENANT, TENANT))
  })

  test('the shared platform endpoint expects no studio, and constrains none', () => {
    // A studio that has supplied no credentials still sells there, and the body
    // is the only thing that names a studio at all.
    assert.doesNotThrow(() => refuse(OTHER, undefined))
  })

  test('an event this system cannot place is not a mismatch', () => {
    // The handlers already treat an unplaceable event as a silent no-op or a
    // loud `client_not_found`; refusing here would only change which error a
    // human reads.
    assert.doesNotThrow(() => refuse(null, TENANT))
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
