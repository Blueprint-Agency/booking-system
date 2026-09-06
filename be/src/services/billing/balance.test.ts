import test from 'node:test'
import assert from 'node:assert/strict'

import {
  amountPaidCents,
  centsToSgd,
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

test('cents come back as the numeric string the ledger stores', () => {
  assert.equal(centsToSgd(0), '0.00')
  assert.equal(centsToSgd(12_950), '129.50')
})
