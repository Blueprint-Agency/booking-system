import assert from 'node:assert'
import { AppError } from '../../shared/errors'
import {
  PART_PAYMENT_FLOOR_CENTS,
  chargeableCents,
  mustPayInFull,
  refusePartPaymentWhenDisabled,
} from './part-payment'

/** The refusal code, so a test asserts the reason and not just the failure. */
function refusal(outstanding: number, requested: number | null): string {
  try {
    chargeableCents(outstanding, requested)
  } catch (err) {
    if (err instanceof AppError) return err.code
    throw err
  }
  return 'accepted'
}

// --- the ordinary sale ------------------------------------------------------
// Unticked Part Payment sends no amount, and the charge is the whole Balance.
// Every sale this system has ever taken is this line.
{
  assert.strictEqual(chargeableCents(12000, null), 12000)
  assert.strictEqual(chargeableCents(50, null), 50, 'a tiny Balance in full is still in full')
}

// --- a genuine split --------------------------------------------------------
{
  assert.strictEqual(chargeableCents(12000, 5000), 5000)
  assert.strictEqual(chargeableCents(12000, 12000), 12000, 'asking for all of it is allowed')
  assert.strictEqual(
    chargeableCents(12000, 11900),
    11900,
    'leaving exactly the floor behind is allowed',
  )
}

// --- more than is owed is refused, never clamped ----------------------------
// A member who sees a smaller charge on their statement than the one they asked
// for has no way to find out why, so we say no instead of quietly adjusting.
{
  assert.strictEqual(refusal(12000, 12001), 'part_payment_exceeds_balance')
  assert.strictEqual(refusal(12000, 99999), 'part_payment_exceeds_balance')
}

// --- neither side of the split may fall under the floor ---------------------
{
  assert.strictEqual(refusal(12000, 99), 'part_payment_below_floor')
  assert.strictEqual(
    refusal(12000, 11901),
    'part_payment_remainder_too_small',
    'a remainder under the floor is a Balance nobody could clear',
  )
  assert.strictEqual(chargeableCents(12000, PART_PAYMENT_FLOOR_CENTS), PART_PAYMENT_FLOOR_CENTS)
}

// --- a Balance already under the floor --------------------------------------
// Pay it all or pay none of it. Charging under the floor may be refused by the
// provider; leaving a sub-floor Balance behind can never be cleared at all.
{
  assert.strictEqual(mustPayInFull(PART_PAYMENT_FLOOR_CENTS), true)
  assert.strictEqual(mustPayInFull(PART_PAYMENT_FLOOR_CENTS + 1), false)
  assert.strictEqual(chargeableCents(60, 60), 60, 'the whole sub-floor remainder is permitted')
  assert.strictEqual(refusal(60, 30), 'part_payment_remainder_too_small')
}

// --- nothing left to pay ----------------------------------------------------
// A settled Purchase refuses a second session rather than opening one that
// could capture money against a Balance of zero.
{
  assert.strictEqual(refusal(0, null), 'purchase_settled')
  assert.strictEqual(refusal(0, 500), 'purchase_settled')
  assert.strictEqual(refusal(-100, null), 'purchase_settled')
}

// --- the studio does not offer it -------------------------------------------
// Refused, never ignored: ignoring the amount would charge the whole price when
// the member asked for part of it, which is more money than they agreed to.
{
  assert.doesNotThrow(() => refusePartPaymentWhenDisabled(null), 'paying in full is always allowed')
  assert.throws(
    () => refusePartPaymentWhenDisabled(5000),
    (err: unknown) => err instanceof AppError && err.code === 'part_payment_unavailable',
  )
}

// --- shapes that are not amounts --------------------------------------------
{
  assert.strictEqual(refusal(12000, 0), 'part_payment_invalid')
  assert.strictEqual(refusal(12000, -500), 'part_payment_invalid')
  assert.strictEqual(refusal(12000, 50.5), 'part_payment_invalid', 'cents are whole')
}
