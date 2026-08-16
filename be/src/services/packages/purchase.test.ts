import { test } from 'node:test'
import assert from 'node:assert/strict'
import { locationForPurchase } from './purchase'

const LOC_A = '11111111-1111-1111-1111-111111111111'
const LOC_B = '22222222-2222-2222-2222-222222222222'

test('an Unlimited Plan must name a Home Location', () => {
  assert.throws(() => locationForPurchase('unlimited', null, []), /unlimited_requires_location/)
  assert.equal(locationForPurchase('unlimited', LOC_A, []), LOC_A)
})

test('no other kind may carry one', () => {
  for (const kind of ['credit_bundle', 'trial', 'pt'] as const) {
    assert.throws(
      () => locationForPurchase(kind, LOC_A, []),
      /location_only_applies_to_unlimited/,
    )
    assert.equal(locationForPurchase(kind, null, []), null)
  }
})

test('a renewal may only sit at the live plan’s Home Location', () => {
  assert.equal(locationForPurchase('unlimited', LOC_A, [LOC_A]), LOC_A)
  assert.throws(
    () => locationForPurchase('unlimited', LOC_B, [LOC_A]),
    /unlimited_renewal_location_mismatch/,
  )
})

test('a live plan with no Home Location constrains nothing', () => {
  assert.equal(locationForPurchase('unlimited', LOC_B, [null]), LOC_B)
})
