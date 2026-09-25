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

const TENANT = '11111111-1111-4111-8111-111111111111'
const CLIENT = '33333333-3333-4333-8333-333333333333'

type Billing = {
  checkoutSessionParams: typeof import('./checkout-session').checkoutSessionParams
  refundAtProvider: typeof import('./refunds').refundAtProvider
  receiptUrlPatch: typeof import('./webhook-handler').receiptUrlPatch
  installStripeFake: typeof import('../../test/stripe-fake').installStripeFake
  setStripeFactory: typeof import('../../lib/stripe').setStripeFactory
  setProviderCredentialsLoader: typeof import('./provider-credentials').setProviderCredentialsLoader
  verifyTenantDelivery: typeof import('./webhook-verification').verifyTenantDelivery
  refuseWrongTenant: typeof import('./webhook-handler').refuseWrongTenant
}

let billing: Billing

/**
 * The modules under test. Called inside each `describe`, not at the top level:
 * every backend test file shares one process, where a top-level hook would run
 * around every other file's tests too, and would reset their Stripe fake.
 *
 * No environment is set: since #293 there is no platform key, signing secret or
 * descriptor prefix to set. A studio's own account is all a call is made on,
 * and each test gives its studio one through the fake.
 */
function setUp(): void {
  before(async () => {
    // Before anything imports `env` or `../../db`, which read the environment at
    // module load, hence the dynamic imports. A placeholder, never dialled:
    // postgres-js connects lazily and nothing in this file reaches the database.
    process.env.DATABASE_APP_URL ||= 'postgres://booking_app:none@127.0.0.1:5432/none'
    const [checkout, refunds, webhook, fake, lib, verification, credentials] = await Promise.all([
      import('./checkout-session'),
      import('./refunds'),
      import('./webhook-handler'),
      import('../../test/stripe-fake'),
      import('../../lib/stripe'),
      import('./webhook-verification'),
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
      verifyTenantDelivery: verification.verifyTenantDelivery,
    }
  })

  // Both halves of the seam. Since #100 the accessor asks which account a call is
  // on before it makes one, and leaving that on the real lookup would send this
  // file — which deliberately has no database — to Postgres.
  afterEach(() => {
    billing.setStripeFactory(null)
    billing.setProviderCredentialsLoader(null)
  })
}

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
  setUp()

  test('the studio is stamped on the session AND on the intent', () => {
    const params = billing.checkoutSessionParams(input())
    assert.equal(params.metadata?.tenant_id, TENANT)
    // The intent is what a refund, a dispute and a bank statement point at, so
    // the studio has to be readable from it without the session.
    assert.deepEqual(params.payment_intent_data?.metadata, {
      tenant_id: TENANT,
      client_id: CLIENT,
    })
  })

  test('every studio charges on its own account, so no suffix is ever sent', () => {
    // The statement already says the studio's name, and the 22-character limit
    // is measured against that account's own prefix — which this platform does
    // not know. A refused charge costs the sale; a missing suffix costs a
    // nicety.
    const params = billing.checkoutSessionParams(input())
    assert.ok(!('statement_descriptor_suffix' in (params.payment_intent_data ?? {})))
    // Still stamped with the studio, because a refund and a dispute point here.
    assert.equal(params.payment_intent_data?.metadata?.tenant_id, TENANT)
  })

  test('every line is one quantity of its own price, in the platform currency', () => {
    const params = billing.checkoutSessionParams(
      input({
        lines: [
          { name: 'Plan', description: 'Acme Yoga', amountCents: 50000 },
          { name: 'Cross-Location Add-On', description: 'Acme Yoga', amountCents: 9000 },
        ],
      }),
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
    const params = billing.checkoutSessionParams(input({ expiresAt }))
    assert.equal(params.expires_at, Math.floor(expiresAt.getTime() / 1000))
  })

  test("no Hold leaves Stripe's own expiry alone", () => {
    assert.ok(!('expires_at' in billing.checkoutSessionParams(input())))
  })
})

describe('the refund call', () => {
  setUp()

  test('the intent is refunded whole, on the account it was taken on', async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('refunds.create', {})

    await billing.refundAtProvider(TENANT, 'pi_123', 'acct_studio')

    const [call] = fake.callsTo('refunds.create')
    assert.deepEqual(call?.args[0], { payment_intent: 'pi_123' })
    assert.equal(call?.account, 'acct_studio')
  })

  test("a payment taken on the studio's own account is returned there", async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('refunds.create', {})

    await billing.refundAtProvider(TENANT, 'pi_new', 'acct_studio')

    assert.equal(fake.callsTo('refunds.create')[0]?.account, 'acct_studio')
  })

  /**
   * The migration (#97, #293). The studio is on its own account now; this
   * payment was taken on the platform's before it moved. Reading the studio's
   * *current* credentials would send the refund to an account where the intent
   * does not exist — the member gets nothing back and the error names an id
   * that looks right. And there is no platform key left to send it on, so it
   * is refused, naming where it can be refunded.
   */
  test("a payment taken on the platform account is refused, not sent on the studio's key", async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('refunds.create', {})

    await assert.rejects(() => billing.refundAtProvider(TENANT, 'pi_old', null), {
      code: 'payment_on_platform_account',
    })

    assert.deepEqual(fake.callsTo('refunds.create'), [])
  })

  test("one Purchase straddling the move: only the payment on the studio's own account is returned here", async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('refunds.create', {})

    await assert.rejects(() => billing.refundAtProvider(TENANT, 'pi_before', null), {
      code: 'payment_on_platform_account',
    })
    await billing.refundAtProvider(TENANT, 'pi_after', 'acct_studio')

    assert.deepEqual(
      fake.callsTo('refunds.create').map(call => [call.account, call.args[0]]),
      [['acct_studio', { payment_intent: 'pi_after' }]],
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
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('refunds.create', {})

    await billing.refundAtProvider(TENANT, 'pi_123', 'acct_studio')
    await billing.refundAtProvider(TENANT, 'pi_123', 'acct_studio')

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
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('refunds.create', new Error('charge_already_refunded'))

    await assert.rejects(() => billing.refundAtProvider(TENANT, 'pi_123', 'acct_studio'), /already_refunded/)
  })
})

describe("the webhook's receipt lookup", () => {
  setUp()

  test('the receipt is read off the latest charge, which must be expanded', async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('paymentIntents.retrieve', {
      latest_charge: { receipt_url: 'https://pay.example.test/r/1' },
    })

    const patch = await billing.receiptUrlPatch(TENANT, 'pi_123', 'acct_studio')

    assert.deepEqual(patch, { receiptUrl: 'https://pay.example.test/r/1' })
    const [call] = fake.callsTo('paymentIntents.retrieve')
    assert.deepEqual(call?.args, ['pi_123', { expand: ['latest_charge'] }])
    assert.equal(call?.account, 'acct_studio')
  })

  test('an unexpanded charge leaves the column absent, not blanked', async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('paymentIntents.retrieve', { latest_charge: 'ch_123' })

    assert.deepEqual(await billing.receiptUrlPatch(TENANT, 'pi_123', 'acct_studio'), {})
  })

  test('a provider failure never fails a purchase that was already delivered', async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('paymentIntents.retrieve', new Error('provider down'))

    assert.deepEqual(await billing.receiptUrlPatch(TENANT, 'pi_123', 'acct_studio'), {})
  })
})

describe('an event that arrived on one studio’s endpoint and names another', () => {
  setUp()

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

  test('an event this system cannot place is not a mismatch', () => {
    // The handlers already treat an unplaceable event as a silent no-op or a
    // loud `client_not_found`; refusing here would only change which error a
    // human reads.
    assert.doesNotThrow(() => refuse(null, TENANT))
  })
})

/**
 * The signature check on a studio's own endpoint (#100, #293), below the route:
 * the route's first step is a database lookup of the slug, and this file has no
 * database. Over HTTP, on `/api/v1/webhooks/stripe/:slug`, a forged signature is
 * refused in `src/test/package-purchase.test.ts` (PAY-17).
 */
describe("the webhook's signature check", () => {
  setUp()

  const verify = (body: string, signature: string) => billing.verifyTenantDelivery(TENANT, body, signature)

  test("the signature is checked against the studio's own signing secret, and only that one", async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio', webhookSecret: 'whsec_studio' })
    fake.reply('webhooks.constructEvent', new Error('no signatures found'))

    assert.equal(await verify('{"id":"evt_1"}', 't=1,v1=deadbeef'), null)

    const calls = fake.callsTo('webhooks.constructEvent')
    assert.equal(calls.length, 1, 'exactly one secret is tried')
    assert.equal(calls[0]?.account, 'acct_studio')
    assert.deepEqual(calls[0]?.args, ['{"id":"evt_1"}', 't=1,v1=deadbeef', 'whsec_studio'])
  })

  test('a body arriving with no signature at all is refused the same way', async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('webhooks.constructEvent', new Error('no signatures found'))

    assert.equal(await verify('{"id":"evt_1"}', ''), null)
    assert.equal(fake.callsTo('webhooks.constructEvent')[0]?.args[1], '')
  })

  test('a studio with no account of its own has nothing to verify against, and is refused', async () => {
    const fake = billing.installStripeFake()
    fake.reply('webhooks.constructEvent', { id: 'evt_1', type: 'payment_intent.created' })

    assert.equal(await verify('{"id":"evt_1"}', 't=1,v1=good'), null)
    assert.deepEqual(fake.calls, [], 'no platform secret is tried in its place')
  })

  test('an event the provider vouches for is handed on with the account that signed it', async () => {
    const fake = billing.installStripeFake()
    fake.credentials(TENANT, { accountId: 'acct_studio' })
    fake.reply('webhooks.constructEvent', { id: 'evt_1', type: 'payment_intent.created' })

    const delivery = await verify('{"id":"evt_1"}', 't=1,v1=good')

    assert.deepEqual(delivery, {
      event: { id: 'evt_1', type: 'payment_intent.created' },
      accountId: 'acct_studio',
    })
  })
})
