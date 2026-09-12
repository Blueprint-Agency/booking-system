import assert from 'node:assert'
import {
  locationForPurchase,
  homeLocationMove,
  instructorForPurchase,
  boundInstructorChange,
} from './purchase'

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

// --- the Bound Instructor a purchase lands on (#109) ---
//
// Same reason the Location rule is pure and tested here: checkout and the grant
// must refuse the same purchases, because a refusal that only fires in the
// webhook has already charged the member.

const COACH_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const COACH_B = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
const LEAVER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
const ROSTER = [COACH_A, COACH_B]

assert.strictEqual(
  instructorForPurchase('pt', true, COACH_A, ROSTER),
  COACH_A,
  'a bound PT package takes the active instructor the member picked',
)

assert.throws(
  () => instructorForPurchase('pt', true, null, ROSTER),
  /pt_bound_requires_instructor/,
  'a bound PT package may not be bought with nobody bound',
)

assert.throws(
  () => instructorForPurchase('pt', true, LEAVER, ROSTER),
  /instructor_not_active/,
  'the studio may not sell sessions with an instructor who has left',
)

// An empty roster is the same refusal and not a pass: a studio with no active
// instructor has nobody to sell bound sessions with.
assert.throws(
  () => instructorForPurchase('pt', true, COACH_A, []),
  /instructor_not_active/,
  'a pick is refused when the roster holds nobody',
)

assert.strictEqual(
  instructorForPurchase('pt', false, null, ROSTER),
  null,
  'an unbound PT package asks the member nothing and lands open',
)

assert.throws(
  () => instructorForPurchase('pt', false, COACH_A, ROSTER),
  /instructor_only_applies_to_bound_pt/,
  'a choice on an unbound PT package is a mistake, not a preference to honour',
)

for (const kind of ['credit_bundle', 'unlimited', 'trial'] as const) {
  assert.strictEqual(
    instructorForPurchase(kind, false, null, ROSTER),
    null,
    `a ${kind} lands with no instructor at all`,
  )
  assert.throws(
    () => instructorForPurchase(kind, true, COACH_A, ROSTER),
    /instructor_only_applies_to_bound_pt/,
    // The flag lives on the PT catalogue, so it can only reach a class package
    // through a caller's mistake. The kind decides, never the flag.
    `a ${kind} cannot be bound to an instructor however the flag arrives`,
  )
}

// --- an admin binds, moves or clears a purchased package's Bound Instructor (#110) ---
//
// A separate rule from the purchase one, because it answers a different
// question: not "what may the studio sell", but "what may an admin change it to
// afterwards". Clearing is allowed here and impossible at checkout, and a no-op
// is a refusal rather than a silent write — the audit trail must not gain a row
// that records nothing.

assert.deepStrictEqual(
  boundInstructorChange('pt', null, COACH_A, ROSTER),
  { ok: true, instructorId: COACH_A },
  'an open PT package can be bound to an active instructor later',
)

assert.deepStrictEqual(
  boundInstructorChange('pt', COACH_A, COACH_B, ROSTER),
  { ok: true, instructorId: COACH_B },
  'a member can be moved to a new coach',
)

assert.deepStrictEqual(
  boundInstructorChange('pt', COACH_A, null, ROSTER),
  { ok: true, instructorId: null },
  'clearing the binding reopens the package to anyone',
)

// The leaver here is the instructor already on the row, not the one being
// picked. A package bound to somebody archived stays bound until an admin
// rebinds it, so their own absence must never be what blocks the rebinding.
assert.deepStrictEqual(
  boundInstructorChange('pt', LEAVER, COACH_A, ROSTER),
  { ok: true, instructorId: COACH_A },
  'a package bound to an archived instructor can still be rebound',
)
assert.deepStrictEqual(
  boundInstructorChange('pt', LEAVER, null, ROSTER),
  { ok: true, instructorId: null },
  'a package bound to an archived instructor can still be cleared',
)

assert.deepStrictEqual(
  boundInstructorChange('pt', null, LEAVER, ROSTER),
  { ok: false, refusal: 'instructor_not_active' },
  'a package may not be bound to somebody who cannot teach it',
)

assert.deepStrictEqual(
  boundInstructorChange('pt', COACH_A, COACH_A, ROSTER),
  { ok: false, refusal: 'bound_instructor_unchanged' },
  'rebinding to the instructor already bound writes nothing and says so',
)
assert.deepStrictEqual(
  boundInstructorChange('pt', null, null, ROSTER),
  { ok: false, refusal: 'bound_instructor_unchanged' },
  'clearing a package that is already open writes nothing and says so',
)

for (const kind of ['credit_bundle', 'unlimited', 'trial'] as const) {
  assert.deepStrictEqual(
    boundInstructorChange(kind, null, COACH_A, ROSTER),
    { ok: false, refusal: 'bound_instructor_requires_pt' },
    `a ${kind} has no Bound Instructor to set`,
  )
  // The kind is refused before the no-op is even considered: what stops the
  // admin is the kind, and answering "unchanged" would imply the action exists
  // for a Credit Bundle and simply had nothing to do.
  assert.deepStrictEqual(
    boundInstructorChange(kind, null, null, ROSTER),
    { ok: false, refusal: 'bound_instructor_requires_pt' },
    `a ${kind} refuses on its kind, not on the change being empty`,
  )
}

console.log('packages/purchase.test ok')
