import assert from 'node:assert'
import { addMonths, applyMovement, computeActive, isDormant, type PackageValidity } from './validity'

const NOW = new Date('2026-06-01T00:00:00Z')
const LATER = new Date('2026-12-01T00:00:00Z')
const EARLIER = new Date('2026-01-01T00:00:00Z')

const bundle = (remaining: number, expiresAt: Date | null = LATER): PackageValidity => ({
  kind: 'credit_bundle',
  expiresAt,
  creditsOrSessionsRemaining: remaining,
})

/** Narrowing helper — a movement that was expected to succeed. */
const ok = (r: ReturnType<typeof applyMovement>) => {
  assert.ok(r.ok, `expected movement to be allowed, got refusal: ${r.ok ? '' : r.refusal}`)
  return r
}

// --- the defect this module exists to fix -----------------------------------
// A bundle spent to zero is flagged unusable; refunding a credit into it must
// make it spendable again, or the credit comes back and nothing will spend it.
{
  const r = ok(applyMovement(bundle(0), +1, NOW))
  assert.strictEqual(r.remaining, 1)
  assert.strictEqual(r.active, true)
}

// A refund into an EXPIRED bundle returns the credit but leaves it unusable —
// expiry outranks balance.
{
  const r = ok(applyMovement(bundle(0, EARLIER), +1, NOW))
  assert.strictEqual(r.remaining, 1)
  assert.strictEqual(r.active, false)
}

// Debit to exactly zero marks the bundle unusable immediately.
{
  const r = ok(applyMovement(bundle(2), -2, NOW))
  assert.strictEqual(r.remaining, 0)
  assert.strictEqual(r.active, false)
}

// Debit that would go below zero is refused, not clamped.
{
  const r = applyMovement(bundle(1), -2, NOW)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.ok === false && r.refusal, 'overdraw')
}

// --- the rest of the movement rules -----------------------------------------

// A partial debit leaves the bundle usable.
{
  const r = ok(applyMovement(bundle(3), -1, NOW))
  assert.strictEqual(r.remaining, 2)
  assert.strictEqual(r.active, true)
}

// A bundle with no expiry never expires out.
{
  const r = ok(applyMovement(bundle(0, null), +2, NOW))
  assert.strictEqual(r.active, true)
}

// Unlimited packages have no balance — refuse rather than write a number onto null.
{
  const r = applyMovement(
    { kind: 'unlimited', expiresAt: LATER, creditsOrSessionsRemaining: null },
    -1,
    NOW,
  )
  assert.strictEqual(r.ok === false && r.refusal, 'unlimited_has_no_balance')
}

// Fractional / non-integer movements are refused.
{
  const r = applyMovement(bundle(5), -0.5, NOW)
  assert.strictEqual(r.ok === false && r.refusal, 'invalid_amount')
}

// PT sessions follow the same rule as class credits (2on1 debits 2).
{
  const r = ok(
    applyMovement({ kind: 'pt', expiresAt: LATER, creditsOrSessionsRemaining: 2 }, -2, NOW),
  )
  assert.strictEqual(r.remaining, 0)
  assert.strictEqual(r.active, false)
}

// --- computeActive, the rule the movement re-derives ------------------------
assert.strictEqual(computeActive(bundle(1), NOW), true)
assert.strictEqual(computeActive(bundle(0), NOW), false)
assert.strictEqual(computeActive(bundle(5, EARLIER), NOW), false)
// Unlimited is usable on validity alone, balance is irrelevant...
assert.strictEqual(
  computeActive({ kind: 'unlimited', expiresAt: LATER, creditsOrSessionsRemaining: null }, NOW),
  true,
)
// ...but not once expired.
assert.strictEqual(
  computeActive({ kind: 'unlimited', expiresAt: EARLIER, creditsOrSessionsRemaining: null }, NOW),
  false,
)

// --- calendar-month Duration ------------------------------------------------
// The defect this arithmetic exists to prevent: a naive `setMonth` rolls 31 August
// plus six months forward into 3 March, handing the member three free days and
// landing the plan in the wrong month.
{
  const end = addMonths(new Date('2026-08-31T00:00:00Z'), 6)
  assert.strictEqual(
    end.toISOString(),
    '2027-02-28T00:00:00.000Z',
    '31 August plus six months must clamp to 28 February, not spill into March',
  )
}

// A leap February clamps to the 29th rather than the 28th.
assert.strictEqual(
  addMonths(new Date('2027-08-31T00:00:00Z'), 6).toISOString(),
  '2028-02-29T00:00:00.000Z',
)

// A day that exists in the target month is kept exactly — 15 Jan + 6 = 15 Jul.
assert.strictEqual(
  addMonths(new Date('2026-01-15T09:30:00Z'), 6).toISOString(),
  '2026-07-15T09:30:00.000Z',
)

// Crossing a year boundary.
assert.strictEqual(
  addMonths(new Date('2026-11-30T00:00:00Z'), 3).toISOString(),
  '2027-02-28T00:00:00.000Z',
)

// --- Dormant ----------------------------------------------------------------
const dormantPlan: PackageValidity = {
  kind: 'unlimited',
  expiresAt: null,
  creditsOrSessionsRemaining: null,
}

assert.strictEqual(isDormant(dormantPlan), true)
assert.strictEqual(
  isDormant({ kind: 'unlimited', expiresAt: LATER }),
  false,
  'an Activated plan carries an expiry and is not Dormant',
)

// A Dormant plan is active. It is bought and paid for and waiting for its first
// booking — flagging it inactive would make it unspendable and unactivatable, so
// nothing would ever start its clock.
assert.strictEqual(
  computeActive(dormantPlan, NOW),
  true,
  'a Dormant Unlimited Plan must be active — nothing is expired that has not started',
)

console.log('packages/validity.test ok')
