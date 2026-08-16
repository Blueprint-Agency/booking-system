import assert from 'node:assert'
import { locationForPurchase } from './purchase'

// The rule this module exists to hold: checkout and the grant must refuse the
// same purchases, because a refusal that only fires in the webhook has already
// charged the member.

const LOC_A = '11111111-1111-1111-1111-111111111111'
const LOC_B = '22222222-2222-2222-2222-222222222222'

// --- only an Unlimited Plan carries a Home Location ---

assert.throws(
  () => locationForPurchase('unlimited', null, []),
  /unlimited_requires_location/,
  'an Unlimited Plan must name the one Location it covers',
)
assert.strictEqual(
  locationForPurchase('unlimited', LOC_A, []),
  LOC_A,
  'a first Unlimited Plan takes the Location the member picked',
)

for (const kind of ['credit_bundle', 'trial', 'pt'] as const) {
  assert.throws(
    () => locationForPurchase(kind, LOC_A, []),
    /location_only_applies_to_unlimited/,
    `a ${kind} must not carry a Home Location`,
  )
  assert.strictEqual(
    locationForPurchase(kind, null, []),
    null,
    `a ${kind} lands with no Location at all`,
  )
}

// --- the renewal rule (§6) ---

assert.strictEqual(
  locationForPurchase('unlimited', LOC_A, [LOC_A]),
  LOC_A,
  'a renewal at the live plan’s own Location is allowed',
)
assert.throws(
  () => locationForPurchase('unlimited', LOC_B, [LOC_A]),
  /unlimited_renewal_location_mismatch/,
  'a renewal may not sit at a Location other than the live plan’s',
)
assert.strictEqual(
  locationForPurchase('unlimited', LOC_B, [null]),
  LOC_B,
  'a live plan with no Home Location constrains nothing',
)

// --- at most one Activated plus one Dormant ---

assert.throws(
  () => locationForPurchase('unlimited', LOC_A, [LOC_A, LOC_A]),
  /unlimited_limit_reached/,
  'a third Unlimited Plan is refused — one Activated plus at most one Dormant',
)

console.log('packages/purchase.test ok')
