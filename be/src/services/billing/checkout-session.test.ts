import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buyerFor,
  checkoutSessionParams,
  itemName,
  partPaymentLine,
  purchaseKindFor,
  totalCents,
  type CheckoutSessionInput,
} from './checkout-session'
import { AppError } from '../../shared/errors'
import { toSgd } from '../../shared/money'

test('the Purchase kind is read off the same field the webhook dispatches on', () => {
  assert.equal(purchaseKindFor({ kind: 'class_package' }), 'class_package')
  assert.equal(purchaseKindFor({ kind: 'pt_package' }), 'pt_package')
  assert.equal(purchaseKindFor({ kind: 'workshop' }), 'workshop')
  assert.equal(purchaseKindFor({ kind: 'merch' }), 'merch')
  assert.equal(purchaseKindFor({ kind: 'cross_location_add_on' }), 'cross_location_add_on')
})

test('a kind nothing could grant is refused rather than becoming a meaningless Purchase', () => {
  assert.throws(() => purchaseKindFor({}), (err: unknown) => {
    assert.ok(err instanceof AppError)
    assert.equal(err.code, 'checkout_kind_unknown')
    return true
  })
  assert.throws(() => purchaseKindFor({ kind: 'corporate_package' }), AppError)
})

test('the total is what the lines add up to — the plan and its Add-On together', () => {
  assert.equal(totalCents([]), 0)
  assert.equal(
    totalCents([
      { name: 'Unlimited 3 months', description: '', amountCents: 500_00 },
      { name: 'Cross-Location Add-On', description: '', amountCents: 90_00 },
    ]),
    590_00,
  )
})

test('a sale with no buyer is refused, not left to fail as a foreign key', () => {
  assert.equal(buyerFor({ client_id: 'c-1' }), 'c-1')
  assert.throws(() => buyerFor({ kind: 'merch' }), (err: unknown) => {
    assert.ok(err instanceof AppError)
    assert.equal(err.code, 'checkout_client_missing')
    return true
  })
})

test('a total in cents becomes the numeric string the ledger stores', () => {
  assert.equal(toSgd(0), '0.00')
  assert.equal(toSgd(590_00), '590.00')
  assert.equal(toSgd(12_950), '129.50')
})

// --- Part Payment (#93) -----------------------------------------------------

const LINES = [
  { name: 'Unlimited · 6 months', description: 'Acme Yoga', amountCents: 600_00 },
  { name: 'Cross-Location Add-On', description: 'Acme Yoga', amountCents: 180_00 },
]

const sessionInput = (over: Partial<CheckoutSessionInput> = {}): CheckoutSessionInput => ({
  tenantId: 't1',
  email: 'member@example.com',
  lines: LINES,
  expiresAt: null,
  metadata: { kind: 'class_package', client_id: 'c-1' },
  successUrl: 'https://studio.example/ok',
  cancelUrl: 'https://studio.example/no',
  ...over,
})

test('an ordinary sale is untouched — every line, every payment method', () => {
  const params = checkoutSessionParams(sessionInput())
  assert.equal(params.line_items?.length, 2)
  assert.deepEqual(
    params.line_items!.map(l => l.price_data!.unit_amount),
    [600_00, 180_00],
  )
  assert.equal(params.payment_method_types, undefined)
})

test('a part payment is ONE line for the instalment, and cards only', () => {
  const params = checkoutSessionParams(
    sessionInput({ partPaymentCents: 300_00 }))
  assert.equal(params.line_items?.length, 1)
  assert.equal(params.line_items![0]!.price_data!.unit_amount, 300_00)
  // PayNow and the other one-shot methods settle outside the session; a balance
  // being closed by a second instalment cannot wait on that.
  assert.deepEqual(params.payment_method_types, ['card'])
})

test('the part-payment line names the remainder, and what it does not buy', () => {
  const partial = partPaymentLine(LINES, 300_00, 480_00)
  assert.match(partial.name, /Part payment towards/)
  assert.match(partial.description, /S\$480\.00/)
  assert.match(partial.description, /no place is held/)

  const settling = partPaymentLine(LINES, 480_00, 0)
  assert.match(settling.description, /settles the balance in full/)
  assert.doesNotMatch(settling.description, /still be owed/)
})

test('an unfinished sale can be named from its Purchase alone', () => {
  assert.equal(itemName(LINES), 'Unlimited · 6 months + 1 more')
  assert.equal(itemName([LINES[0]!]), 'Unlimited · 6 months')
  assert.equal(itemName([]), 'Purchase')
})

// --- Saved cards (#185) -----------------------------------------------------

test('without a Customer the session is an email, exactly as it always was', () => {
  const params = checkoutSessionParams(sessionInput())
  assert.equal(params.customer_email, 'member@example.com')
  assert.equal(params.customer, undefined)
  assert.equal(params.payment_intent_data?.setup_future_usage, undefined)
})

test('a Customer replaces the email — Stripe refuses a session carrying both', () => {
  const params = checkoutSessionParams(sessionInput({ customerId: 'cus_1' }))
  assert.equal(params.customer, 'cus_1')
  assert.equal(params.customer_email, undefined)
})

test('a card is kept only where the member asked for it to be kept', () => {
  const asked = checkoutSessionParams(
    sessionInput({ customerId: 'cus_1', saveCard: true }))
  // `on_session`: this card is only ever charged with the member watching, so
  // the bank can authenticate then rather than up front.
  assert.equal(asked.payment_intent_data?.setup_future_usage, 'on_session')

  const declined = checkoutSessionParams(
    sessionInput({ customerId: 'cus_1', saveCard: false }))
  assert.equal(declined.payment_intent_data?.setup_future_usage, undefined)
})

test('consent without a Customer keeps nothing — there is nothing to attach to', () => {
  const params = checkoutSessionParams(sessionInput({ saveCard: true }))
  assert.equal(params.payment_intent_data?.setup_future_usage, undefined)
  assert.equal(params.customer_email, 'member@example.com')
})

test('a part payment still carries the Customer — that is the whole point of it', () => {
  const params = checkoutSessionParams(
    sessionInput({ customerId: 'cus_1', partPaymentCents: 300_00 }))
  assert.equal(params.customer, 'cus_1')
  assert.deepEqual(params.payment_method_types, ['card'])
})

test('keeping the card makes a full-price checkout cards-only, and says so here', () => {
  // `setup_future_usage` makes the provider drop every method it cannot save,
  // so this would happen anyway — pinned here so it is a stated rule with a
  // matching sentence on our own page, rather than PayNow quietly vanishing.
  const keeping = checkoutSessionParams(
    sessionInput({ customerId: 'cus_1', saveCard: true }))
  assert.deepEqual(keeping.payment_method_types, ['card'])
})

test('PayNow survives a full payment that keeps no card — the default', () => {
  // The acceptance line this protects: PayNow never appears on a Part Payment,
  // and does appear on a full one. An untouched `payment_method_types` is what
  // lets the studio's own enabled methods through.
  const plain = checkoutSessionParams(sessionInput({ customerId: 'cus_1' }))
  assert.equal(plain.payment_method_types, undefined)

  const declined = checkoutSessionParams(
    sessionInput({ customerId: 'cus_1', saveCard: false }))
  assert.equal(declined.payment_method_types, undefined)
})

test('consent with no Customer narrows nothing — it was never going to save', () => {
  const params = checkoutSessionParams(sessionInput({ saveCard: true }))
  assert.equal(params.payment_method_types, undefined)
})

test('the metadata a saved card rides in on is still the tenant-stamped one', () => {
  const params = checkoutSessionParams(
    sessionInput({ customerId: 'cus_1', saveCard: true }))
  assert.equal(params.payment_intent_data?.metadata?.tenant_id, 't1')
  assert.equal(params.payment_intent_data?.metadata?.client_id, 'c-1')
})
