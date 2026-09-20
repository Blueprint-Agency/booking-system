/**
 * The two rules in `payment-customers.ts` that are decisions rather than
 * plumbing: what a member is told about their own card, and whether a card is
 * theirs at all (#185).
 *
 * Both are pure, and both are the kind of thing that breaks silently — one by
 * leaking a field, the other by letting a member detach somebody else's card —
 * so both are pinned here, with no provider and no database in the way.
 *
 * The functions around them (`providerCustomerFor`, `listSavedCards`,
 * `removeSavedCard`, `forgetProviderCustomers`) read the database as well as
 * the provider, so they belong in the integration suite under `src/test/` that
 * runs against `TEST_DATABASE_URL`, and are **not** covered here.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type Stripe from 'stripe'

import { cardBelongsTo, describeCard } from './payment-customers'

const card = (over: Record<string, unknown> = {}) =>
  ({
    id: 'pm_1',
    object: 'payment_method',
    type: 'card',
    card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2031 },
    ...over,
  }) as unknown as Stripe.PaymentMethod

test('a member is told the brand, the last four and the expiry, and nothing more', () => {
  const described = describeCard(card())
  assert.deepEqual(described, {
    id: 'pm_1',
    brand: 'visa',
    last4: '4242',
    expMonth: 4,
    expYear: 2031,
  })
})

test('a field the provider adds does not become a field of ours', () => {
  // Built key by key rather than spread, so a provider that starts returning a
  // fingerprint, a country or a wallet cannot widen this platform's response.
  const described = describeCard(
    card({
      card: {
        brand: 'visa',
        last4: '4242',
        exp_month: 4,
        exp_year: 2031,
        fingerprint: 'FpSecret',
        country: 'SG',
      },
      customer: 'cus_1',
    }),
  )
  assert.deepEqual(Object.keys(described!).sort(), ['brand', 'expMonth', 'expYear', 'id', 'last4'])
  assert.ok(!JSON.stringify(described).includes('FpSecret'))
})

test('a payment method that is not a card is dropped, not shown with blank digits', () => {
  assert.equal(describeCard(card({ type: 'paynow', card: undefined })), null)
})

test('a card is the member’s whether the provider names the Customer or expands it', () => {
  assert.equal(cardBelongsTo(card({ customer: 'cus_1' }), 'cus_1'), true)
  assert.equal(cardBelongsTo(card({ customer: { id: 'cus_1' } }), 'cus_1'), true)
})

test('another member’s card is not the member’s', () => {
  assert.equal(cardBelongsTo(card({ customer: 'cus_2' }), 'cus_1'), false)
  assert.equal(cardBelongsTo(card({ customer: { id: 'cus_2' } }), 'cus_1'), false)
})

test('a card attached to nobody belongs to nobody — never to whoever asked', () => {
  // The case that matters: `undefined === undefined` would have made every
  // detached card everyone's.
  assert.equal(cardBelongsTo(card({ customer: null }), 'cus_1'), false)
  assert.equal(cardBelongsTo(card({ customer: undefined }), 'cus_1'), false)
  assert.equal(cardBelongsTo(null, 'cus_1'), false)
  assert.equal(cardBelongsTo(undefined, 'cus_1'), false)
})
