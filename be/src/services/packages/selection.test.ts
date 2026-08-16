import assert from 'node:assert'
import { selectPackage, type CandidatePackage, type SelectionInput } from './selection'

const NOW = new Date('2026-06-01T00:00:00Z')
const CLASS_AT = new Date('2026-06-10T09:00:00Z')
const HOME = 'loc-breadtalk'
const OTHER = 'loc-outram'

let seq = 0
const plan = (over: Partial<CandidatePackage> = {}): CandidatePackage => ({
  id: `plan-${++seq}`,
  kind: 'unlimited',
  expiresAt: new Date('2026-12-01T00:00:00Z'),
  locationId: HOME,
  durationMonths: 6,
  creditsOrSessionsRemaining: null,
  ...over,
})

/** A Dormant plan: bought, paid for, clock not yet started. */
const dormant = (over: Partial<CandidatePackage> = {}) => plan({ expiresAt: null, ...over })

const bundle = (over: Partial<CandidatePackage> = {}): CandidatePackage => ({
  id: `bundle-${++seq}`,
  kind: 'credit_bundle',
  expiresAt: new Date('2026-12-01T00:00:00Z'),
  locationId: null,
  durationMonths: null,
  creditsOrSessionsRemaining: 10,
  ...over,
})

const select = (packages: CandidatePackage[], over: Partial<SelectionInput> = {}) =>
  selectPackage({
    packages,
    classLocationId: HOME,
    classStartsAt: CLASS_AT,
    creditCost: 1,
    useCredits: false,
    now: NOW,
    ...over,
  })

/** Narrowing helper — a selection that was expected to succeed. */
const ok = (r: ReturnType<typeof selectPackage>) => {
  assert.ok(r.ok, `expected a package to be chosen, got refusal: ${r.ok ? '' : r.refusal}`)
  return r
}

// --- the defect this module exists to fix -----------------------------------
// A member holding a plan for one studio and credits used to have the credits
// spent silently when they booked at the other studio.
{
  const r = select([plan({ locationId: OTHER }), bundle()])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(
    r.ok === false && r.refusal,
    'location_not_covered',
    'a class outside the plan’s Location must be refused, never paid for out of credits',
  )
}

// The same booking with use_credits set falls through and spends a credit.
{
  const b = bundle()
  const r = ok(select([plan({ locationId: OTHER }), b], { useCredits: true }))
  assert.strictEqual(r.clientPackageId, b.id)
  assert.strictEqual(r.creditsUsed, 1)
  assert.strictEqual(r.activateUntil, null, 'paying with credits must not start a plan’s clock')
}

// use_credits is taken at its word even when a plan DOES cover the class: it is
// how a member keeps a Dormant plan waiting rather than starting its clock (§3).
{
  const b = bundle()
  const r = ok(select([dormant(), b], { useCredits: true }))
  assert.strictEqual(r.clientPackageId, b.id)
  assert.strictEqual(r.activateUntil, null, 'a waiting plan must stay waiting')
}

// --- Location coverage ------------------------------------------------------

// A plan at the class's Location pays, and spends no credits.
{
  const p = plan()
  const r = ok(select([p, bundle()]))
  assert.strictEqual(r.clientPackageId, p.id)
  assert.strictEqual(r.creditsUsed, 0)
}

// A member with only credits is unaffected by any of it.
{
  const b = bundle()
  const r = ok(select([b]))
  assert.strictEqual(r.clientPackageId, b.id)
  assert.strictEqual(r.creditsUsed, 1)
}

// An EXPIRED plan is not a live plan — it refuses nothing and the member's
// credits pay as they always did.
{
  const b = bundle()
  const r = ok(select([plan({ locationId: OTHER, expiresAt: new Date('2026-01-01T00:00:00Z') }), b]))
  assert.strictEqual(r.clientPackageId, b.id)
}

// No credits either → the plain out-of-credits refusal, not the coverage one.
{
  const r = select([bundle({ creditsOrSessionsRemaining: 0 })])
  assert.strictEqual(r.ok === false && r.refusal, 'insufficient_credits')
}

// --- ordering ---------------------------------------------------------------

// Activated is preferred over Dormant — the plan with a running clock pays first.
{
  const activated = plan()
  const r = ok(select([dormant(), activated]))
  assert.strictEqual(r.clientPackageId, activated.id)
  assert.strictEqual(r.activateUntil, null)
}

// The soonest-expiring Activated plan wins, so the one about to lapse is used up.
{
  const soon = plan({ expiresAt: new Date('2026-07-01T00:00:00Z') })
  const later = plan({ expiresAt: new Date('2026-11-01T00:00:00Z') })
  assert.strictEqual(ok(select([later, soon])).clientPackageId, soon.id)
}

// --- activation -------------------------------------------------------------

// The first class booking a Dormant plan pays for stamps its end date at the
// BOOKING moment plus the Duration — not at the class date, which would hand a
// member a free extension for booking the furthest-out class on the schedule.
{
  const r = ok(select([dormant({ durationMonths: 6 })]))
  assert.strictEqual(
    r.activateUntil?.toISOString(),
    '2026-12-01T00:00:00.000Z',
    'activation runs from the booking moment, never from the class date',
  )
}

// A Dormant plan waits for the plan in front of it to END, even when that plan
// lapses before the class does. Activating it early would put two Activated
// plans on the member and hit the partial unique index in their face.
{
  const r = select([plan({ expiresAt: new Date('2026-06-05T00:00:00Z') }), dormant()])
  assert.strictEqual(r.ok, false, 'a Dormant plan must not activate beside a running one')
  assert.strictEqual(r.ok === false && r.refusal, 'location_not_covered')
}

// Once the plan in front has expired, the Dormant one pays and starts its clock.
{
  const r = ok(select([plan({ expiresAt: new Date('2026-05-01T00:00:00Z') }), dormant()]))
  assert.strictEqual(r.activateUntil?.toISOString(), '2026-12-01T00:00:00.000Z')
}

// --- validity when the class actually runs ----------------------------------

// A Dormant plan whose Duration would end before the class starts is refused
// rather than chosen — activating it would instantly invalidate it for the very
// class that activated it.
{
  const r = select([dormant({ durationMonths: 3 })], {
    classStartsAt: new Date('2026-10-01T09:00:00Z'),
  })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.ok === false && r.refusal, 'location_not_covered')
}

// Same for an Activated plan that lapses between today and the class.
{
  const r = select([plan({ expiresAt: new Date('2026-06-05T00:00:00Z') })])
  assert.strictEqual(r.ok === false && r.refusal, 'location_not_covered')
}

// A credit bundle that lapses before the class cannot pay for it either.
{
  const r = select([bundle({ expiresAt: new Date('2026-06-05T00:00:00Z') })])
  assert.strictEqual(r.ok === false && r.refusal, 'insufficient_credits')
}

// A bundle short of the class's credit cost is not chosen.
{
  const enough = bundle({ creditsOrSessionsRemaining: 2 })
  const r = ok(select([bundle({ creditsOrSessionsRemaining: 1 }), enough], { creditCost: 2 }))
  assert.strictEqual(r.clientPackageId, enough.id)
  assert.strictEqual(r.creditsUsed, 2)
}

// A trial pass pays like a bundle.
{
  const t = bundle({ kind: 'trial', creditsOrSessionsRemaining: 1 })
  assert.strictEqual(ok(select([t])).clientPackageId, t.id)
}

// PT sessions never pay for a class.
{
  const r = select([bundle({ kind: 'pt', creditsOrSessionsRemaining: 5 })])
  assert.strictEqual(r.ok === false && r.refusal, 'insufficient_credits')
}

console.log('packages/selection.test ok')
