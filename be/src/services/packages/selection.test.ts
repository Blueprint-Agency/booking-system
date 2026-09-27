import assert from 'node:assert'
import {
  ACCEPTS_ALL,
  classifyPackages,
  selectPackage,
  type CandidatePackage,
  type SelectionInput,
} from './selection'

const NOW = new Date('2026-06-01T00:00:00Z')
const CLASS_AT = new Date('2026-06-10T09:00:00Z')
const HOME = 'loc-harbour'
const OTHER = 'loc-parkside'
/** The catalogue packages every plan and bundle below were bought as. */
const CATALOGUE_PLAN = 'cat-plan'
const CATALOGUE_BUNDLE = 'cat-bundle'

let seq = 0
/** An Activated (running) Unlimited Plan at the Home Location. */
const plan = (over: Partial<CandidatePackage> = {}): CandidatePackage => ({
  id: `plan-${++seq}`,
  kind: 'unlimited',
  sourceClassPackageId: CATALOGUE_PLAN,
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
  sourceClassPackageId: CATALOGUE_BUNDLE,
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
    rule: ACCEPTS_ALL,
    now: NOW,
    ...over,
  })

const classify = (packages: CandidatePackage[], over: Partial<SelectionInput> = {}) =>
  classifyPackages({
    packages,
    classLocationId: HOME,
    classStartsAt: CLASS_AT,
    creditCost: 1,
    rule: ACCEPTS_ALL,
    now: NOW,
    ...over,
  })

/** Narrowing helper — a selection that was expected to succeed. */
const ok = (r: ReturnType<typeof selectPackage>) => {
  assert.ok(r.ok, `expected a package to be chosen, got refusal: ${r.ok ? '' : r.refusal}`)
  return r
}

// --- several packages run per Family: the Default payer ----------------------
// Nothing waits behind a running package any more. Each package answers for
// itself; the Default payer is the first Eligible one in default order.

// A running plan at the other studio, credits waiting: the plan cannot pay, so
// the waiting credits do, and start their clock.
{
  const b = dormantBundle()
  const r = ok(select([plan({ locationId: OTHER }), b]))
  assert.strictEqual(r.clientPackageId, b.id, 'a plan that does not Cover the class no longer blocks the credits')
  assert.strictEqual(r.activateUntil?.toISOString(), '2026-08-30T00:00:00.000Z')
}

// A running bundle, Dormant plan waiting: the running bundle pays and the plan
// waits — a running package is preferred, so no new clock starts by accident.
{
  const b = bundle({ creditsOrSessionsRemaining: 3 })
  const r = ok(select([dormant(), b]))
  assert.strictEqual(r.clientPackageId, b.id)
  assert.strictEqual(r.creditsUsed, 1)
  assert.strictEqual(r.activateUntil, null, 'the waiting plan must stay waiting')
}

// The running bundle is short of the class's cost: the Dormant plan behind it
// steps in and starts.
{
  const p = dormant()
  const r = ok(select([p, bundle({ creditsOrSessionsRemaining: 1 })], { creditCost: 2 }))
  assert.strictEqual(r.clientPackageId, p.id)
  assert.strictEqual(r.creditsUsed, 0)
  assert.strictEqual(r.activateUntil?.toISOString(), '2026-12-01T00:00:00.000Z')
}

// A running bundle that lapses before the class cannot pay; the Dormant bundle
// behind it can, and starts.
{
  const next = dormantBundle()
  const r = ok(select([bundle({ expiresAt: new Date('2026-06-05T00:00:00Z') }), next]))
  assert.strictEqual(r.clientPackageId, next.id)
  assert.ok(r.activateUntil)
}

// A running plan that lapses before the class: the Dormant renewal pays, beside
// it — two Activated plans at once is allowed now.
{
  const renewal = dormant()
  const r = ok(select([plan({ expiresAt: new Date('2026-06-05T00:00:00Z') }), renewal]))
  assert.strictEqual(r.clientPackageId, renewal.id)
  assert.strictEqual(r.activateUntil?.toISOString(), '2026-12-01T00:00:00.000Z')
}

// A plan for the OTHER Location running and a Dormant one for this one: the
// Dormant one Covers the class and pays.
{
  const here = dormant()
  const r = ok(select([plan({ locationId: OTHER }), here]))
  assert.strictEqual(r.clientPackageId, here.id)
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

// Two running packages: the soonest-ending one pays first.
{
  const later = bundle({ expiresAt: new Date('2026-11-01T00:00:00Z') })
  const sooner = bundle({ expiresAt: new Date('2026-07-01T00:00:00Z') })
  assert.strictEqual(ok(select([later, sooner])).clientPackageId, sooner.id)
  const longPlan = plan({ expiresAt: new Date('2026-11-01T00:00:00Z') })
  const shortPlan = plan({ expiresAt: new Date('2026-07-01T00:00:00Z') })
  assert.strictEqual(ok(select([longPlan, shortPlan])).clientPackageId, shortPlan.id)
}

// --- the member's pick ---------------------------------------------------------

// A running package the member names pays even when the default would pick another.
{
  const sooner = bundle({ expiresAt: new Date('2026-07-01T00:00:00Z') })
  const later = plan()
  const r = ok(select([sooner, later], { clientPackageId: later.id }))
  assert.strictEqual(r.clientPackageId, later.id)
  assert.strictEqual(r.creditsUsed, 0)
}

// Picking a Dormant package while another runs Activates it, stamped from today.
{
  const b = dormantBundle({ validityDays: 90 })
  const r = ok(select([plan(), b], { clientPackageId: b.id }))
  assert.strictEqual(r.clientPackageId, b.id)
  assert.strictEqual(r.creditsUsed, 1)
  assert.strictEqual(r.activateUntil?.toISOString(), '2026-08-30T00:00:00.000Z')
}

// An Ineligible pick is refused with that package's own reason — never quietly
// swapped for the Default payer.
{
  const away = plan({ locationId: OTHER })
  const r = select([away, bundle()], { clientPackageId: away.id })
  assert.strictEqual(r.ok === false && r.refusal, 'location_not_covered')
  const short = bundle({ creditsOrSessionsRemaining: 1 })
  const r2 = select([short, plan()], { clientPackageId: short.id, creditCost: 2 })
  assert.strictEqual(r2.ok === false && r2.refusal, 'insufficient_credits')
  const lapsing = bundle({ expiresAt: new Date('2026-06-05T00:00:00Z') })
  const r3 = select([lapsing, plan()], { clientPackageId: lapsing.id })
  assert.strictEqual(r3.ok === false && r3.refusal, 'plan_expires_before_class')
}

// A pick that is not one of the member's live class packages is not found.
{
  const r = select([plan()], { clientPackageId: 'someone-elses' })
  assert.strictEqual(r.ok === false && r.refusal, 'client_package_not_found')
  const pt = bundle({ kind: 'pt', creditsOrSessionsRemaining: 5, validityDays: 365 })
  const r2 = select([pt, plan()], { clientPackageId: pt.id })
  assert.strictEqual(r2.ok === false && r2.refusal, 'client_package_not_found', 'a PT package never pays for a class')
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

// With nothing running, a plan is preferred over credits — the member keeps the
// plan waiting by picking the credits, and starting them is itself an Activation.
{
  const p = dormant()
  const b = dormantBundle()
  assert.strictEqual(ok(select([b, p])).clientPackageId, p.id)
  const r = ok(select([p, b], { clientPackageId: b.id }))
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
// credits pay by default; the plan alone is refused on coverage.
{
  const b = dormantBundle()
  assert.strictEqual(ok(select([dormant({ locationId: OTHER }), b])).clientPackageId, b.id)
  const r = select([dormant({ locationId: OTHER })])
  assert.strictEqual(r.ok === false && r.refusal, 'location_not_covered')
}

// Nothing Eligible refuses with the reason of the first package in default
// order: a running plan elsewhere comes before a Dormant bundle short of credits.
{
  const r = select([dormantBundle({ creditsOrSessionsRemaining: 1 }), plan({ locationId: OTHER })], { creditCost: 2 })
  assert.strictEqual(r.ok === false && r.refusal, 'location_not_covered')
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

// A Dormant bundle whose validity would end before the class is not started,
// and says why.
{
  const r = select([dormantBundle({ validityDays: 5 })])
  assert.strictEqual(r.ok === false && r.refusal, 'plan_expires_before_class')
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

// PT sessions never pay for a class, and never block one either — a different Family.
{
  const r = select([bundle({ kind: 'pt', creditsOrSessionsRemaining: 5, validityDays: 365 })])
  assert.strictEqual(r.ok === false && r.refusal, 'insufficient_credits')
  const b = dormantBundle()
  const pt = bundle({ kind: 'pt', creditsOrSessionsRemaining: 5, validityDays: 365 })
  assert.strictEqual(ok(select([pt, b])).clientPackageId, b.id)
}

// --- classification: what the Book sheet lists --------------------------------

// Every live class package, in default order, each Eligible or with its reason.
{
  const runningLate = bundle({ id: 'run-late', expiresAt: new Date('2026-11-01T00:00:00Z') })
  const runningSoon = plan({ id: 'run-soon', expiresAt: new Date('2026-07-01T00:00:00Z'), locationId: OTHER })
  const waitingBundle = dormantBundle({ id: 'wait-bundle', creditsOrSessionsRemaining: 1 })
  const waitingPlan = dormant({ id: 'wait-plan' })
  const spent = bundle({ id: 'spent', creditsOrSessionsRemaining: 0 })
  const rows = classify([waitingBundle, spent, runningLate, waitingPlan, runningSoon], { creditCost: 2 })
  assert.deepStrictEqual(
    rows.map(r => [r.pkg.id, r.running, r.reason]),
    [
      ['run-soon', true, 'location_not_covered'],
      ['run-late', true, null],
      ['wait-plan', false, null],
      ['wait-bundle', false, 'insufficient_credits'],
    ],
  )
  assert.strictEqual(rows[2]!.activateUntil?.toISOString(), '2026-12-01T00:00:00.000Z', 'a Dormant row says the end it would get')
  assert.strictEqual(rows[1]!.activateUntil, null, 'a running row starts nothing')
}

// --- the class's Package rule -------------------------------------------------

// `only` takes the packages named and nothing else; the refused one says why,
// before anything else about it.
{
  const b = bundle()
  const p = plan({ locationId: OTHER })
  const rows = classify([b, p], { rule: { mode: 'only', packageIds: [CATALOGUE_BUNDLE] } })
  assert.deepStrictEqual(
    rows.map(r => [r.pkg.id, r.reason]),
    [
      [b.id, null],
      [p.id, 'not_accepted'],
    ],
    'not_accepted is tested before coverage',
  )
  assert.strictEqual(ok(select([p, b], { rule: { mode: 'only', packageIds: [CATALOGUE_BUNDLE] } })).clientPackageId, b.id)
}

// `except` refuses the packages named and takes the rest, a package with no
// catalogue source included; `only` names no such package.
{
  const unsourced = bundle({ sourceClassPackageId: null })
  const except = { mode: 'except', packageIds: [CATALOGUE_BUNDLE] } as const
  assert.strictEqual(ok(select([bundle(), unsourced], { rule: except })).clientPackageId, unsourced.id)
  assert.deepStrictEqual(select([unsourced], { rule: { mode: 'only', packageIds: [CATALOGUE_BUNDLE] } }), {
    ok: false,
    refusal: 'not_accepted',
  })
}

// The Default payer skips a package the class does not accept, even a running
// one, and starts a Dormant one that it does.
{
  const waiting = dormant()
  const r = ok(select([bundle(), waiting], { rule: { mode: 'except', packageIds: [CATALOGUE_BUNDLE] } }))
  assert.strictEqual(r.clientPackageId, waiting.id)
  assert.ok(r.activateUntil, 'the accepted Dormant plan starts')
}

// A member's pick of a package the class does not accept is refused with it.
{
  const b = bundle()
  assert.deepStrictEqual(
    select([b, plan()], { clientPackageId: b.id, rule: { mode: 'except', packageIds: [CATALOGUE_BUNDLE] } }),
    { ok: false, refusal: 'not_accepted' },
  )
}

// Nothing can pay: an accepted package's own reason is the one given, since the
// member can fix it; `not_accepted` only when no package is accepted.
{
  const only = { mode: 'only', packageIds: [CATALOGUE_PLAN] } as const
  const refused = select([bundle(), plan({ locationId: OTHER })], { rule: only })
  assert.deepStrictEqual(refused, { ok: false, refusal: 'location_not_covered' })
  assert.deepStrictEqual(select([bundle(), bundle()], { rule: only }), { ok: false, refusal: 'not_accepted' })
  assert.deepStrictEqual(select([], { rule: only }), { ok: false, refusal: 'insufficient_credits' })
}

console.log('packages/selection.test ok')
