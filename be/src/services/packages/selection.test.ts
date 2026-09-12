import assert from 'node:assert'
import { selectPackage, type CandidatePackage, type SelectionInput } from './selection'

const NOW = new Date('2026-06-01T00:00:00Z')
const CLASS_AT = new Date('2026-06-10T09:00:00Z')
const HOME = 'loc-harbour'
const OTHER = 'loc-parkside'

let seq = 0
/** An Activated (running) Unlimited Plan at the Home Location. */
const plan = (over: Partial<CandidatePackage> = {}): CandidatePackage => ({
  id: `plan-${++seq}`,
  kind: 'unlimited',
  expiresAt: new Date('2026-12-01T00:00:00Z'),
  locationId: HOME,
  durationMonths: 6,
  validityDays: null,
  creditsOrSessionsRemaining: null,
  crossLocationPaidSgd: null,
  purchasedAt: new Date(`2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`),
  ...over,
})

/** A Dormant plan: bought, paid for, clock not yet started. */
const dormant = (over: Partial<CandidatePackage> = {}) => plan({ expiresAt: null, ...over })

/** An Activated (running) Credit Bundle. */
const bundle = (over: Partial<CandidatePackage> = {}): CandidatePackage => ({
  id: `bundle-${++seq}`,
  kind: 'credit_bundle',
  expiresAt: new Date('2026-12-01T00:00:00Z'),
  locationId: null,
  durationMonths: null,
  validityDays: 90,
  creditsOrSessionsRemaining: 10,
  crossLocationPaidSgd: null,
  purchasedAt: new Date(`2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`),
  ...over,
})

/** A Dormant Credit Bundle — every bundle is one until its first booking. */
const dormantBundle = (over: Partial<CandidatePackage> = {}) => bundle({ expiresAt: null, ...over })

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

// --- one Activated package per family ----------------------------------------
// The rule this module exists to enforce: while one package in the class family
// is running, it is the only one that can pay. Nothing behind it starts.

// A running plan at the other studio, credits waiting: refused, never paid for
// out of the waiting credits — not even when the member asks for credits.
{
  const r = select([plan({ locationId: OTHER }), dormantBundle()])
  assert.strictEqual(r.ok === false && r.refusal, 'location_not_covered')
  const forced = select([plan({ locationId: OTHER }), dormantBundle()], { useCredits: true })
  assert.strictEqual(
    forced.ok === false && forced.refusal,
    'location_not_covered',
    'credits cannot start while a plan is running, whatever the member asks',
  )
}

// A running bundle, Dormant plan waiting: the bundle pays and the plan waits.
{
  const b = bundle({ creditsOrSessionsRemaining: 3 })
  const r = ok(select([dormant(), b]))
  assert.strictEqual(r.clientPackageId, b.id)
  assert.strictEqual(r.creditsUsed, 1)
  assert.strictEqual(r.activateUntil, null, 'the waiting plan must stay waiting')
}

// The running bundle is short of the class's cost: refused. The plan behind it
// does not jump the queue.
{
  const r = select([dormant(), bundle({ creditsOrSessionsRemaining: 1 })], { creditCost: 2 })
  assert.strictEqual(r.ok === false && r.refusal, 'insufficient_credits')
}

// A running bundle that lapses before the class cannot pay, and the Dormant
// bundle behind it must not start early either.
{
  const r = select([bundle({ expiresAt: new Date('2026-06-05T00:00:00Z') }), dormantBundle()])
  assert.strictEqual(r.ok === false && r.refusal, 'plan_expires_before_class')
}

// A Dormant plan waits for the plan in front of it to END, even when that plan
// lapses before the class does. Activating it early would put two Activated
// packages on the member and hit the partial unique index in their face.
{
  const r = select([plan({ expiresAt: new Date('2026-06-05T00:00:00Z') }), dormant()])
  assert.strictEqual(r.ok, false, 'a Dormant plan must not activate beside a running one')
  assert.strictEqual(
    r.ok === false && r.refusal,
    'plan_expires_before_class',
    'the running plan Covers this Location — it just runs out first, and the member is told so',
  )
}

// A member holding a plan for the OTHER Location and a Dormant one for this one
// is still refused on coverage: nothing that Covers the class ran out, the
// renewal is merely queued behind a plan that does not cover it.
{
  const r = select([plan({ locationId: OTHER }), dormant()])
  assert.strictEqual(r.ok === false && r.refusal, 'location_not_covered')
}

// Once the package in front has expired, the Dormant one pays and starts its clock.
{
  const r = ok(select([plan({ expiresAt: new Date('2026-05-01T00:00:00Z') }), dormant()]))
  assert.strictEqual(r.activateUntil?.toISOString(), '2026-12-01T00:00:00.000Z')
}

// A bundle spent to zero is not a candidate at all (the caller filters on
// `active`, but selection must not trip over one either).
{
  const next = dormantBundle()
  const r = ok(select([bundle({ creditsOrSessionsRemaining: 0 }), next]))
  assert.strictEqual(r.clientPackageId, next.id, 'the next bundle starts once the running one is empty')
}

// --- activation ---------------------------------------------------------------

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

// A Dormant bundle Activates the same way: booking moment plus its frozen validity.
{
  const b = dormantBundle({ validityDays: 90 })
  const r = ok(select([b]))
  assert.strictEqual(r.clientPackageId, b.id)
  assert.strictEqual(r.creditsUsed, 1)
  assert.strictEqual(r.activateUntil?.toISOString(), '2026-08-30T00:00:00.000Z')
}

// Waiting packages start in the order they were bought.
{
  const first = dormantBundle({ purchasedAt: new Date('2026-02-01T00:00:00Z') })
  const second = dormantBundle({ purchasedAt: new Date('2026-03-01T00:00:00Z') })
  assert.strictEqual(ok(select([second, first])).clientPackageId, first.id)
}
{
  const first = dormant({ purchasedAt: new Date('2026-02-01T00:00:00Z') })
  const second = dormant({ purchasedAt: new Date('2026-03-01T00:00:00Z') })
  assert.strictEqual(ok(select([second, first])).clientPackageId, first.id)
}

// With nothing running, a plan is preferred over credits — unless the member
// asks for credits, which is how a Dormant plan is kept waiting (§3). Starting
// the credits is itself an Activation.
{
  const p = dormant()
  const b = dormantBundle()
  assert.strictEqual(ok(select([b, p])).clientPackageId, p.id)
  const r = ok(select([p, b], { useCredits: true }))
  assert.strictEqual(r.clientPackageId, b.id)
  assert.strictEqual(r.activateUntil?.toISOString(), '2026-08-30T00:00:00.000Z')
}

// --- Location coverage --------------------------------------------------------

// A running plan at the class's Location pays, and spends no credits.
{
  const p = plan()
  const r = ok(select([p, dormantBundle()]))
  assert.strictEqual(r.clientPackageId, p.id)
  assert.strictEqual(r.creditsUsed, 0)
  assert.strictEqual(r.activateUntil, null)
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

// A Dormant plan for the other studio, nothing running, credits waiting: the
// coverage refusal, and the credits only with use_credits.
{
  const b = dormantBundle()
  const r = select([dormant({ locationId: OTHER }), b])
  assert.strictEqual(r.ok === false && r.refusal, 'location_not_covered')
  const forced = ok(select([dormant({ locationId: OTHER }), b], { useCredits: true }))
  assert.strictEqual(forced.clientPackageId, b.id)
}

// --- the Cross-Location Add-On ------------------------------------------------

// A plan carrying an Add-On Covers the other Location too, so it is chosen at
// either — the Add-On is exactly the thing the member paid for.
{
  const p = plan({ locationId: OTHER, crossLocationPaidSgd: '180.00' })
  const r = ok(select([p, dormantBundle()]))
  assert.strictEqual(r.clientPackageId, p.id, 'a plan carrying an Add-On pays away from home')
  assert.strictEqual(r.creditsUsed, 0, 'covered by the Add-On means no credit is spent')
}

// And still at its own Home Location — the Add-On adds cover, never moves it.
{
  const p = plan({ crossLocationPaidSgd: '180.00' })
  assert.strictEqual(ok(select([p, dormantBundle()])).clientPackageId, p.id)
}

// A Dormant plan carrying an Add-On activates on a class at the other Location.
{
  const r = ok(select([dormant({ locationId: OTHER, crossLocationPaidSgd: '180.00' })]))
  assert.strictEqual(r.activateUntil?.toISOString(), '2026-12-01T00:00:00.000Z')
}

// --- validity when the class actually runs ------------------------------------

// A Dormant plan whose Duration would end before the class starts is refused
// rather than chosen — activating it would instantly invalidate it for the very
// class that activated it.
{
  const r = select([dormant({ durationMonths: 3 })], {
    classStartsAt: new Date('2026-10-01T09:00:00Z'),
  })
  assert.strictEqual(r.ok === false && r.refusal, 'plan_expires_before_class')
}

// Same for a running plan that lapses between today and the class.
{
  const r = select([plan({ expiresAt: new Date('2026-06-05T00:00:00Z') })])
  assert.strictEqual(
    r.ok === false && r.refusal,
    'plan_expires_before_class',
    'expiry is not a coverage problem, and buying the Add-On would not fix it',
  )
}

// A Dormant bundle whose validity would end before the class is not started.
{
  const r = select([dormantBundle({ validityDays: 5 })])
  assert.strictEqual(r.ok === false && r.refusal, 'insufficient_credits')
}

// A waiting bundle short of the class's credit cost is skipped for one that fits.
{
  const enough = dormantBundle({ creditsOrSessionsRemaining: 2 })
  const r = ok(select([dormantBundle({ creditsOrSessionsRemaining: 1 }), enough], { creditCost: 2 }))
  assert.strictEqual(r.clientPackageId, enough.id)
  assert.strictEqual(r.creditsUsed, 2)
}

// A trial pass pays like a bundle, and starts like one.
{
  const t = dormantBundle({ kind: 'trial', creditsOrSessionsRemaining: 1, validityDays: 14 })
  const r = ok(select([t]))
  assert.strictEqual(r.clientPackageId, t.id)
  assert.strictEqual(r.activateUntil?.toISOString(), '2026-06-15T00:00:00.000Z')
}

// PT sessions never pay for a class, and never block one either — a different family.
{
  const r = select([bundle({ kind: 'pt', creditsOrSessionsRemaining: 5, validityDays: 365 })])
  assert.strictEqual(r.ok === false && r.refusal, 'insufficient_credits')
  const b = dormantBundle()
  const pt = bundle({ kind: 'pt', creditsOrSessionsRemaining: 5, validityDays: 365 })
  assert.strictEqual(ok(select([pt, b])).clientPackageId, b.id)
}

console.log('packages/selection.test ok')
