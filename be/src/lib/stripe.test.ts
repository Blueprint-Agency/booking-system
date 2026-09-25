import assert from 'node:assert'
import Stripe from 'stripe'
import { afterEach, describe, test } from 'node:test'
import {
  providerAccountForTenant,
  stripeForProviderAccount,
  stripeForTenant,
  setStripeFactory,
} from './stripe'
import { installStripeFake } from '../test/stripe-fake'
import { providerCredentials, setProviderCredentialsLoader } from '../services/billing/provider-credentials'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'

/** A studio's own credentials, as the real lookup hands them out. */
const ownAccount = (accountId: string) =>
  providerCredentials({ accountId, secretKey: `sk_test_${accountId}`, webhookSecret: `whsec_${accountId}` })

/** The refusal a studio with no account of its own gets (#293). */
const paymentsNotConfigured = { code: 'payments_not_configured', status: 409 }

describe('the Tenant-bound provider accessor', () => {
  afterEach(() => {
    setStripeFactory(null)
    setProviderCredentialsLoader(null)
  })

  test('a studio that has supplied nothing has no account, and no client is built for it (#293)', async () => {
    const fake = installStripeFake()
    assert.equal(await providerAccountForTenant(TENANT_A), null)
    assert.equal(await providerAccountForTenant(TENANT_B), null)
    await assert.rejects(() => stripeForTenant(TENANT_A), paymentsNotConfigured)
    assert.deepEqual(fake.calls, [])
  })

  test("a studio with its own credentials resolves to its own account", async () => {
    const fake = installStripeFake()
    fake.credentials(TENANT_A, { accountId: 'acct_studio_a' })

    const account = await providerAccountForTenant(TENANT_A)

    assert.equal(account?.accountId, 'acct_studio_a')
    // The studio beside it is untouched — this is what makes onboarding one
    // studio at a time safe.
    assert.equal(await providerAccountForTenant(TENANT_B), null)
  })

  test('with nothing substituted, the accessor hands out a real client', async () => {
    // The lookup alone is substituted — nothing in this file has a database —
    // and the client it produces is the real one.
    setProviderCredentialsLoader(async () => ownAccount('acct_studio_a'))
    assert.ok((await stripeForTenant(TENANT_A)) instanceof Stripe)
  })

  test('a fake substitutes at the seam, with no network and no key', async () => {
    const fake = installStripeFake()
    fake.credentials(TENANT_A, { accountId: 'acct_studio_a' })
    fake.reply('refunds.create', { id: 're_fake' })

    const stripe = await stripeForTenant(TENANT_A)
    const refund = await stripe.refunds.create({ payment_intent: 'pi_1' })

    assert.deepEqual(refund, { id: 're_fake' })
    assert.deepEqual(fake.callsTo('refunds.create')[0]?.args, [{ payment_intent: 'pi_1' }])
  })

  test("each studio's call is made on that studio's own account", async () => {
    const fake = installStripeFake()
    fake.credentials(TENANT_A, { accountId: 'acct_studio_a' })
    fake.credentials(TENANT_B, { accountId: 'acct_studio_b' })
    fake.reply('refunds.create', {})

    await (await stripeForTenant(TENANT_A)).refunds.create({ payment_intent: 'pi_1' })
    await (await stripeForTenant(TENANT_B)).refunds.create({ payment_intent: 'pi_2' })

    // Each studio takes its own money. Neither call site knows the difference.
    assert.deepEqual(
      fake.calls.map(call => call.account),
      ['acct_studio_a', 'acct_studio_b'],
    )
  })

  test('the secret never leaves as data — it is not serialisable', async () => {
    const fake = installStripeFake()
    fake.credentials(TENANT_A, { accountId: 'acct_studio_a', secretKey: 'sk_live_do_not_log' })

    const account = await providerAccountForTenant(TENANT_A)

    // The two accidents this guards against: a log line carrying the object,
    // and a route spreading it into a response.
    assert.equal(JSON.stringify(account), '{"accountId":"acct_studio_a"}')
    assert.deepEqual({ ...account! }, { accountId: 'acct_studio_a' })
    // Still readable by anyone who means to read it.
    assert.equal(account?.secretKey, 'sk_live_do_not_log')
  })

  test('restoring puts the real provider back, so a fake cannot outlive its test', async () => {
    const fake = installStripeFake()
    fake.credentials(TENANT_A, { accountId: 'acct_studio_a' })
    fake.restore()
    // Restoring puts the lookup back on the database too; stand in for it
    // alone, so the client below can only have come from the real factory.
    setProviderCredentialsLoader(async () => ownAccount('acct_studio_a'))
    assert.ok((await stripeForTenant(TENANT_A)) instanceof Stripe)
  })
})

/**
 * The other question (#97): not "where does this studio sell?" but "where did
 * *this payment* come in?". They are the same answer until a studio moves, and
 * different forever afterwards.
 */
describe('the payment-bound provider accessor', () => {
  afterEach(() => {
    setStripeFactory(null)
    setProviderCredentialsLoader(null)
  })

  test('no account on the payment is the platform account, which is refused rather than reached (#293)', async () => {
    const fake = installStripeFake()
    fake.reply('refunds.create', {})

    await assert.rejects(() => stripeForProviderAccount(TENANT_A, null), {
      code: 'payment_on_platform_account',
      status: 409,
    })

    assert.deepEqual(fake.calls, [])
  })

  test("the studio's own account resolves to the studio's own key", async () => {
    const fake = installStripeFake()
    fake.credentials(TENANT_A, { accountId: 'acct_studio_a' })
    fake.reply('refunds.create', {})

    await (
      await stripeForProviderAccount(TENANT_A, 'acct_studio_a')
    ).refunds.create({ payment_intent: 'pi' })

    assert.equal(fake.calls[0]?.account, 'acct_studio_a')
  })

  test("a studio's history on the platform account is not reached with the studio's own key (#293)", async () => {
    const fake = installStripeFake()
    fake.credentials(TENANT_A, { accountId: 'acct_studio_a' })
    fake.reply('refunds.create', {})

    // The studio sells on its own account today; this payment predates that,
    // and no key this platform holds can reach it.
    await assert.rejects(() => stripeForProviderAccount(TENANT_A, null), {
      code: 'payment_on_platform_account',
    })

    assert.deepEqual(fake.calls, [])
  })

  test('an account no key is held for throws rather than falling back', async () => {
    const fake = installStripeFake()
    fake.credentials(TENANT_A, { accountId: 'acct_studio_a' })

    // Falling back to another key would send the call somewhere the intent
    // does not exist, and report a failure that names the wrong cause.
    await assert.rejects(
      () => stripeForProviderAccount(TENANT_A, 'acct_gone'),
      /no credentials held for provider account acct_gone/,
    )
  })

  test('a studio with no credentials at all cannot reach a named account, and is told why', async () => {
    installStripeFake()
    // The same refusal as its checkout (#293): it holds no key for anything.
    await assert.rejects(() => stripeForProviderAccount(TENANT_B, 'acct_studio_a'), paymentsNotConfigured)
  })
})
