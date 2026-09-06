import assert from 'node:assert'
import Stripe from 'stripe'
import { afterEach, describe, test } from 'node:test'
import {
  descriptorSuffix,
  providerAccountForTenant,
  statementDescriptorPrefixProblem,
  stripeForTenant,
  stripePlatform,
  setStripeFactory,
} from './stripe'
import { installStripeFake } from '../test/stripe-fake'

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
  afterEach(() => setStripeFactory(null))

  test('every studio still sells on the platform account', async () => {
    assert.equal(await providerAccountForTenant(TENANT_A), null)
    assert.equal(await providerAccountForTenant(TENANT_B), null)
  })

  test('with nothing substituted, the accessor hands out a real client', async () => {
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

  test('the client is built for the account the mapping names, not the tenant id', async () => {
    const fake = installStripeFake()
    fake.reply('refunds.create', {})

    await (await stripeForTenant(TENANT_A)).refunds.create({ payment_intent: 'pi_1' })
    await (await stripeForTenant(TENANT_B)).refunds.create({ payment_intent: 'pi_2' })

    // One account today, so one client — and the recorded account is what a
    // connected-account change (#94) will flip, at `providerAccountForTenant`.
    assert.deepEqual(
      fake.calls.map(call => call.account),
      [null, null],
    )
  })

  test('restoring puts the real provider back, so a fake cannot outlive its test', async () => {
    const fake = installStripeFake()
    fake.restore()
    assert.ok((await stripeForTenant(TENANT_A)) instanceof Stripe)
  })
})
