import assert from 'node:assert'
import Stripe from 'stripe'
import { afterEach, describe, test } from 'node:test'
import {
  descriptorSuffix,
  providerAccountForTenant,
  statementDescriptorPrefixProblem,
  stripeForProviderAccount,
  stripeForTenant,
  stripePlatform,
  setStripeFactory,
} from './stripe'
import { installStripeFake } from '../test/stripe-fake'
import { setProviderCredentialsLoader } from '../services/billing/provider-credentials'

const MAX = 22

describe('statement descriptor suffix', () => {
  test('a studio name that fits is sent as it stands', () => {
    // 'RSVT' + '* ' leaves 16 characters.
    assert.equal(descriptorSuffix('RSVT', 'Acme Yoga'), 'Acme Yoga')
  })

  test('a longer name is cut to what the prefix leaves, never past 22 in total', () => {
    const suffix = descriptorSuffix('RSVT', 'The Very Long Studio Name Company')
    assert.ok(suffix)
    assert.ok('RSVT'.length + 2 + suffix.length <= MAX)
  })

  test('characters Stripe refuses are dropped rather than sent', () => {
    assert.equal(descriptorSuffix('RSVT', 'Acme <Yoga>* "SG"'), 'Acme Yoga SG')
  })

  test('a name with no letters left is no suffix at all', () => {
    assert.equal(descriptorSuffix('RSVT', '***'), undefined)
  })

  test('no prefix configured means no suffix — Stripe refuses one without it', () => {
    assert.equal(descriptorSuffix(undefined, 'Acme Yoga'), undefined)
    assert.equal(descriptorSuffix('', 'Acme Yoga'), undefined)
  })

  test('a prefix that fills the limit leaves no room, and is not crowded', () => {
    assert.equal(descriptorSuffix('A'.repeat(21), 'Acme Yoga'), undefined)
  })
})

describe('statement descriptor prefix check', () => {
  test('payments not configured is not a problem — there are no charges to mislabel', () => {
    assert.equal(statementDescriptorPrefixProblem(false, undefined), undefined)
    assert.equal(statementDescriptorPrefixProblem(false, ''), undefined)
  })

  test('payments configured with no prefix is a problem, and it names the variable', () => {
    const problem = statementDescriptorPrefixProblem(true, undefined)
    assert.ok(problem)
    assert.match(problem, /STRIPE_STATEMENT_DESCRIPTOR_PREFIX/)
  })

  test('a blank prefix is the same problem as an absent one', () => {
    assert.ok(statementDescriptorPrefixProblem(true, '   '))
  })

  test('a prefix that leaves no room for a suffix is a problem', () => {
    const problem = statementDescriptorPrefixProblem(true, 'A'.repeat(21))
    assert.ok(problem)
    assert.match(problem, /room/)
  })

  test('a usable prefix is no problem', () => {
    assert.equal(statementDescriptorPrefixProblem(true, 'RESERVE'), undefined)
  })

  test('the check and the charge path measure the same prefix', () => {
    // Whitespace a GitHub variable picked up must not pass the check and then
    // quietly cost the suffix a character of its room.
    const padded = ` ${'A'.repeat(21)} `
    assert.ok(statementDescriptorPrefixProblem(true, padded))
    assert.equal(descriptorSuffix(padded.trim(), 'Acme Yoga'), undefined)
  })
})

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'

describe('the Tenant-bound provider accessor', () => {
  afterEach(() => {
    setStripeFactory(null)
    setProviderCredentialsLoader(null)
  })

  test('a studio that has supplied nothing still sells on the platform account', async () => {
    installStripeFake()
    assert.equal(await providerAccountForTenant(TENANT_A), null)
    assert.equal(await providerAccountForTenant(TENANT_B), null)
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
    setProviderCredentialsLoader(async () => null)
    assert.ok((await stripeForTenant(TENANT_A)) instanceof Stripe)
    assert.ok(stripePlatform() instanceof Stripe)
  })

  test('a fake substitutes at the seam, with no network and no key', async () => {
    const fake = installStripeFake()
    fake.reply('refunds.create', { id: 're_fake' })

    const stripe = await stripeForTenant(TENANT_A)
    const refund = await stripe.refunds.create({ payment_intent: 'pi_1' })

    assert.deepEqual(refund, { id: 're_fake' })
    assert.deepEqual(fake.callsTo('refunds.create')[0]?.args, [{ payment_intent: 'pi_1' }])
  })

  test("each studio's call is made on that studio's own account", async () => {
    const fake = installStripeFake()
    fake.credentials(TENANT_A, { accountId: 'acct_studio_a' })
    fake.reply('refunds.create', {})

    await (await stripeForTenant(TENANT_A)).refunds.create({ payment_intent: 'pi_1' })
    await (await stripeForTenant(TENANT_B)).refunds.create({ payment_intent: 'pi_2' })

    // One studio takes its own money; the one beside it still sells on the
    // platform's account. Neither call site knows the difference.
    assert.deepEqual(
      fake.calls.map(call => call.account),
      ['acct_studio_a', null],
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
    fake.restore()
    assert.ok(stripePlatform() instanceof Stripe)
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

  test('no account on the payment is the platform account, not an unknown one', async () => {
    const fake = installStripeFake()
    fake.reply('refunds.create', {})

    await (await stripeForProviderAccount(TENANT_A, null)).refunds.create({ payment_intent: 'pi' })

    assert.equal(fake.calls[0]?.account, null)
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

  test('a studio that has moved still reaches its history on the platform account', async () => {
    const fake = installStripeFake()
    fake.credentials(TENANT_A, { accountId: 'acct_studio_a' })
    fake.reply('refunds.create', {})

    // The studio sells on its own account today; this payment predates that.
    await (await stripeForProviderAccount(TENANT_A, null)).refunds.create({ payment_intent: 'pi' })

    assert.equal(fake.calls[0]?.account, null)
  })

  test('an account no key is held for throws rather than falling back', async () => {
    const fake = installStripeFake()
    fake.credentials(TENANT_A, { accountId: 'acct_studio_a' })

    // Falling back to the platform's key would send the call somewhere the
    // intent does not exist, and report a failure that names the wrong cause.
    await assert.rejects(
      () => stripeForProviderAccount(TENANT_A, 'acct_gone'),
      /no credentials held for provider account acct_gone/,
    )
  })

  test('a studio with no credentials at all cannot reach a named account', async () => {
    installStripeFake()
    await assert.rejects(
      () => stripeForProviderAccount(TENANT_B, 'acct_studio_a'),
      /no credentials held for provider account acct_studio_a/,
    )
  })
})
