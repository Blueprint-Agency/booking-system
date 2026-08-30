import assert from 'node:assert'
import { tierEffectivePrice } from './book'
import { workshopTiers } from '../../db/schema/schedule'
import type { PromotionRow } from '../packages/promotions'

type WorkshopTierRow = typeof workshopTiers.$inferSelect

const NOW = new Date('2026-06-01T00:00:00Z')
const BEFORE = new Date('2026-05-01T00:00:00Z')
const AFTER = new Date('2026-07-01T00:00:00Z')

function tier(over: Partial<WorkshopTierRow> = {}): WorkshopTierRow {
  return {
    id: 'tier-1',
    tenantId: null,
    workshopId: 'ws-1',
    name: 'Full pass',
    description: null,
    regularPriceSgd: '200.00',
    earlyBirdPriceSgd: null,
    earlyBirdQuota: null,
    earlyBirdCutoffAt: null,
    ord: 1,
    ...over,
  }
}

let seq = 0n
function promo(over: Partial<PromotionRow> & Pick<PromotionRow, 'kind'>): PromotionRow {
  seq += 1n
  return {
    id: `promo-${seq}`,
    tenantId: null,
    parentType: 'workshop',
    parentId: 'ws-1',
    label: 'test promo',
    percentOff: null,
    specialPriceSgd: null,
    startsAt: new Date('2026-01-01T00:00:00Z'),
    endsAt: new Date('2026-12-31T00:00:00Z'),
    status: 'active',
    sortId: seq,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdByStaffId: 'staff-1',
    ...over,
  }
}

// ---------- ordinary case: live early bird ----------
assert.deepStrictEqual(
  tierEffectivePrice(tier({ earlyBirdPriceSgd: '150.00', earlyBirdCutoffAt: AFTER }), [], NOW),
  { baseSgd: '150.00', appliedPromotionId: null },
)

// ---------- no promotion applies ----------
assert.deepStrictEqual(tierEffectivePrice(tier(), [], NOW), {
  baseSgd: '200.00',
  appliedPromotionId: null,
})
// regular price is normalised to 2dp by bestPrice on the way through
assert.deepStrictEqual(tierEffectivePrice(tier({ regularPriceSgd: '200' }), [], NOW), {
  baseSgd: '200.00',
  appliedPromotionId: null,
})
// a promo that isn't cheaper than regular is ignored
assert.deepStrictEqual(
  tierEffectivePrice(tier(), [promo({ kind: 'special_price', specialPriceSgd: '250.00' })], NOW),
  { baseSgd: '200.00', appliedPromotionId: null },
)

// ---------- early bird not configured / expired ----------
// cutoff already passed → falls back to regular + promotions
{
  const p = promo({ kind: 'percent', percentOff: 25 })
  assert.deepStrictEqual(
    tierEffectivePrice(tier({ earlyBirdPriceSgd: '150.00', earlyBirdCutoffAt: BEFORE }), [p], NOW),
    { baseSgd: '150.00', appliedPromotionId: p.id },
  )
}
// exactly AT the cutoff instant the early bird is already OFF (`> now`, not `>=`)
assert.deepStrictEqual(
  tierEffectivePrice(tier({ earlyBirdPriceSgd: '150.00', earlyBirdCutoffAt: NOW }), [], NOW),
  { baseSgd: '200.00', appliedPromotionId: null },
)
// one microsecond later it is on
assert.deepStrictEqual(
  tierEffectivePrice(
    tier({ earlyBirdPriceSgd: '150.00', earlyBirdCutoffAt: new Date(NOW.getTime() + 1) }),
    [],
    NOW,
  ),
  { baseSgd: '150.00', appliedPromotionId: null },
)
// CURRENT BEHAVIOUR (config trap): an early-bird price with NO cutoff never
// applies — both halves of the guard are required.
assert.deepStrictEqual(
  tierEffectivePrice(tier({ earlyBirdPriceSgd: '150.00', earlyBirdCutoffAt: null }), [], NOW),
  { baseSgd: '200.00', appliedPromotionId: null },
)
// ...and a cutoff with no price likewise falls through to regular.
assert.deepStrictEqual(
  tierEffectivePrice(tier({ earlyBirdPriceSgd: null, earlyBirdCutoffAt: AFTER }), [], NOW),
  { baseSgd: '200.00', appliedPromotionId: null },
)

// ---------- expired / out-of-window promotion ----------
// CURRENT BEHAVIOUR (possible defect, inherited from bestPrice): the promo
// window is never checked here. Callers must pre-filter via
// listActivePromotionsFor — an expired row handed in is applied at face value.
{
  const expired = promo({
    kind: 'percent',
    percentOff: 50,
    startsAt: new Date('2020-01-01T00:00:00Z'),
    endsAt: new Date('2020-02-01T00:00:00Z'),
  })
  assert.deepStrictEqual(tierEffectivePrice(tier(), [expired], NOW), {
    baseSgd: '100.00',
    appliedPromotionId: expired.id,
  })
}

// ---------- early bird vs promotion precedence, BOTH orders ----------
// (a) early bird cheaper than the promo price → early bird, promo discarded
{
  const p = promo({ kind: 'special_price', specialPriceSgd: '120.00' })
  assert.deepStrictEqual(
    tierEffectivePrice(tier({ earlyBirdPriceSgd: '90.00', earlyBirdCutoffAt: AFTER }), [p], NOW),
    { baseSgd: '90.00', appliedPromotionId: null },
  )
}
// (b) early bird MORE EXPENSIVE than the promo price → early bird STILL wins.
// This is the documented rule (early bird takes precedence while the cutoff is
// live) and fe-client's tierEffectivePrice mirrors it, so display and charge
// agree — but the member pays 150.00 while a 50%-off promo advertising 100.00
// is live, and appliedPromotionId is null so nothing records that it was
// swallowed. Flagged as a pricing-policy sharp edge, not a code bug.
{
  const p = promo({ kind: 'percent', percentOff: 50 })
  assert.deepStrictEqual(
    tierEffectivePrice(tier({ earlyBirdPriceSgd: '150.00', earlyBirdCutoffAt: AFTER }), [p], NOW),
    { baseSgd: '150.00', appliedPromotionId: null },
  )
}
// (c) once the cutoff passes, the very same promo takes over
{
  const p = promo({ kind: 'percent', percentOff: 50 })
  assert.deepStrictEqual(
    tierEffectivePrice(tier({ earlyBirdPriceSgd: '150.00', earlyBirdCutoffAt: BEFORE }), [p], NOW),
    { baseSgd: '100.00', appliedPromotionId: p.id },
  )
}
// CURRENT BEHAVIOUR (possible defect): early_bird_quota is never consulted —
// tierEffectivePrice takes no booking count and nothing else in be/src reads
// the column, so an early-bird price with quota 1 is granted to every buyer
// until the cutoff.
assert.deepStrictEqual(
  tierEffectivePrice(
    tier({ earlyBirdPriceSgd: '150.00', earlyBirdCutoffAt: AFTER, earlyBirdQuota: 1 }),
    [],
    NOW,
  ),
  { baseSgd: '150.00', appliedPromotionId: null },
)

// ---------- discount larger than the price ----------
// No floor at zero (see promotions.test.ts) — a negative special price flows
// straight through to the amount charged for the workshop.
{
  const p = promo({ kind: 'special_price', specialPriceSgd: '-25.00' })
  assert.deepStrictEqual(tierEffectivePrice(tier(), [p], NOW), {
    baseSgd: '-25.00',
    appliedPromotionId: p.id,
  })
}
// A promo taking the tier to exactly 0.00 is the "free workshop" path that
// routes/client/purchases.ts branches on (baseCents === 0).
{
  const p = promo({ kind: 'special_price', specialPriceSgd: '0.00' })
  assert.deepStrictEqual(tierEffectivePrice(tier(), [p], NOW), {
    baseSgd: '0.00',
    appliedPromotionId: p.id,
  })
}
// An early bird of 0.00 also reaches that branch, with no promotion recorded.
assert.deepStrictEqual(
  tierEffectivePrice(tier({ earlyBirdPriceSgd: '0.00', earlyBirdCutoffAt: AFTER }), [], NOW),
  { baseSgd: '0.00', appliedPromotionId: null },
)

// ---------- tie-break flows through from bestPrice ----------
{
  const late = promo({ kind: 'percent', percentOff: 50, sortId: 9n })
  const early = promo({ kind: 'special_price', specialPriceSgd: '100.00', sortId: 3n })
  assert.strictEqual(tierEffectivePrice(tier(), [late, early], NOW).appliedPromotionId, early.id)
  assert.strictEqual(tierEffectivePrice(tier(), [early, late], NOW).appliedPromotionId, early.id)
}

console.log('workshops/book.test ok')
