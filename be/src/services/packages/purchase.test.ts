import assert from 'node:assert'
import { locationForPurchase, homeLocationMove } from './purchase'

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

// --- an admin moves a Home Location (§7) ---

const PKG_ACTIVATED = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PKG_DORMANT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const bothAtA = [
  { id: PKG_ACTIVATED, locationId: LOC_A },
  { id: PKG_DORMANT, locationId: LOC_A },
]

assert.deepStrictEqual(
  homeLocationMove('unlimited', PKG_ACTIVATED, bothAtA, LOC_B),
  { ok: true, moveIds: [PKG_ACTIVATED, PKG_DORMANT] },
  'the Activated plan and the Dormant renewal move together, never one without the other',
)
assert.deepStrictEqual(
  homeLocationMove('unlimited', PKG_DORMANT, bothAtA, LOC_B),
  { ok: true, moveIds: [PKG_ACTIVATED, PKG_DORMANT] },
  'the same move whichever of the two plans staff aimed at',
)
assert.deepStrictEqual(
  homeLocationMove('unlimited', PKG_ACTIVATED, [{ id: PKG_ACTIVATED, locationId: LOC_A }], LOC_B),
  { ok: true, moveIds: [PKG_ACTIVATED] },
  'a member holding one plan moves that one',
)

for (const kind of ['credit_bundle', 'trial', 'pt'] as const) {
  assert.deepStrictEqual(
    homeLocationMove(kind, PKG_ACTIVATED, bothAtA, LOC_B),
    { ok: false, refusal: 'home_location_requires_unlimited' },
    `a ${kind} has no Home Location to move`,
  )
}

assert.deepStrictEqual(
  homeLocationMove('unlimited', PKG_ACTIVATED, bothAtA, LOC_A),
  { ok: false, refusal: 'home_location_unchanged' },
  'a move to the Location the plans already sit at is refused, not audited as a change',
)

assert.deepStrictEqual(
  homeLocationMove('unlimited', PKG_ACTIVATED, [{ id: PKG_DORMANT, locationId: LOC_A }], LOC_B),
  { ok: false, refusal: 'home_location_plan_not_live' },
  'an expired plan is history — moving it would restate what the member held',
)

// Two live plans that already disagree — rows predating the renewal rule, or a
// half-finished fix. Aiming at the one already at the destination must still
// bring the other along, or the disagreement §7 exists to prevent is unfixable
// through the only route that can fix it.
assert.deepStrictEqual(
  homeLocationMove(
    'unlimited',
    PKG_DORMANT,
    [
      { id: PKG_ACTIVATED, locationId: LOC_A },
      { id: PKG_DORMANT, locationId: LOC_B },
    ],
    LOC_B,
  ),
  { ok: true, moveIds: [PKG_ACTIVATED, PKG_DORMANT] },
  'unchanged means every live plan already sits there, not just the one staff clicked',
)

console.log('packages/purchase.test ok')
