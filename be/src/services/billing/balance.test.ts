import test from 'node:test'
import assert from 'node:assert/strict'

import {
  amountPaidCents,
  heldPayments,
  isSettled,
  outstandingCents,
  type PaymentEvidence,
} from './balance'

const payment = (
  paymentIntentId: string,
  amountSgd: string,
  status: PaymentEvidence['status'] = 'succeeded',
): PaymentEvidence => ({ paymentIntentId, amountSgd, status })

test('a purchase with no payments has paid nothing and owes everything', () => {
  assert.equal(amountPaidCents([]), 0)
  assert.equal(outstandingCents(50_00, 0), 50_00)
  assert.equal(isSettled(50_00, 0), false)
})

test('one payment for the whole total settles — the only shape that exists today', () => {
  const payments = [payment('pi_1', '129.00')]
  const paid = amountPaidCents(payments)
  assert.equal(paid, 129_00)
  assert.equal(isSettled(129_00, paid), true)
})

test('the payment being processed counts before its row is flipped to succeeded', () => {
  // The webhook inserts `pending` and only flips after the grant. Without the
  // crediting intent the Balance would never reach zero and nothing would ever
  // be granted.
  const payments = [payment('pi_1', '129.00', 'pending')]
  assert.equal(amountPaidCents(payments), 0)
  assert.equal(amountPaidCents(payments, 'pi_1'), 129_00)
})

test('a redelivery after the flip does not count the same payment twice', () => {
  const payments = [payment('pi_1', '129.00', 'succeeded')]
  assert.equal(amountPaidCents(payments, 'pi_1'), 129_00)
})

test('two part payments together settle the purchase', () => {
  const first = [payment('pi_1', '300.00', 'pending')]
  const afterFirst = amountPaidCents(first, 'pi_1')
  assert.equal(isSettled(500_00, afterFirst), false, 'a Balance outstanding grants nothing')
  assert.equal(outstandingCents(500_00, afterFirst), 200_00)

  const both = [payment('pi_1', '300.00'), payment('pi_2', '200.00', 'pending')]
  const afterSecond = amountPaidCents(both, 'pi_2')
  assert.equal(afterSecond, 500_00)
  assert.equal(isSettled(500_00, afterSecond), true)
})

test('refunded and failed payments count for nothing', () => {
  const payments = [
    payment('pi_1', '300.00', 'refunded'),
    payment('pi_2', '200.00', 'failed'),
  ]
  assert.equal(amountPaidCents(payments), 0)
  assert.equal(isSettled(500_00, amountPaidCents(payments)), false)
})

test('cents, not floats — a total that floats would round short of settled', () => {
  const payments = [payment('pi_1', '0.1'), payment('pi_2', '0.2')]
  assert.equal(amountPaidCents(payments), 30)
  assert.equal(isSettled(30, amountPaidCents(payments)), true)
})

test('an overpayment owes nothing rather than less than nothing', () => {
  assert.equal(outstandingCents(100_00, 150_00), 0)
  assert.equal(isSettled(100_00, 150_00), true)
})

// ── what a Refund still has to give back (#92) ───────────────────────────────

test('a Refund of a purchase settled by one payment has one call to make', () => {
  const held = heldPayments([payment('pi_1', '129.00')])
  assert.deepEqual(held.map(p => p.paymentIntentId), ['pi_1'])
})

test('a Refund walks every payment the purchase holds, not just the last', () => {
  const held = heldPayments([payment('pi_1', '300.00'), payment('pi_2', '200.00')])
  assert.deepEqual(held.map(p => p.paymentIntentId), ['pi_1', 'pi_2'])
})

test('a purchase with one payment back and one still held is not a finished Refund', () => {
  // The unwind refuses this state: voiding the plan here would take the
  // member's entitlement away while the studio still held part of their money.
  const held = heldPayments([
    payment('pi_1', '300.00', 'refunded'),
    payment('pi_2', '200.00'),
  ])
  assert.deepEqual(held.map(p => p.paymentIntentId), ['pi_2'])
})

test('a Refund is complete only when nothing is held', () => {
  const payments: PaymentEvidence[] = [
    payment('pi_1', '300.00', 'refunded'),
    payment('pi_2', '200.00', 'refunded'),
  ]
  assert.deepEqual(heldPayments(payments), [])
})

test('a payment stuck pending is money the provider still holds, and is returned', () => {
  // The row is only inserted once the provider confirmed the money; the flip to
  // succeeded waits for the grant. A pending row is a delivery that died
  // between the two, and voiding a plan without giving that money back is the
  // one outcome this must never produce.
  const held = heldPayments([payment('pi_1', '300.00', 'pending')])
  assert.deepEqual(held.map(p => p.paymentIntentId), ['pi_1'])
})

test('a failed payment never became money, so it holds a Refund up for nothing', () => {
  const payments: PaymentEvidence[] = [
    payment('pi_1', '300.00', 'refunded'),
    payment('pi_2', '200.00', 'failed'),
  ]
  assert.deepEqual(heldPayments(payments), [])
})

test('a purchase that never reached the provider has nothing to give back', () => {
  assert.deepEqual(heldPayments([]), [])
})

