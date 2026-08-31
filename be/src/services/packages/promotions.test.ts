import assert from 'node:assert'
import { bestPrice, type PromotionRow } from './promotions'
import { TENANT_ONE_ID } from '../../db/schema/tenancy'

// Minimal PromotionRow factory — only the fields bestPrice reads matter
// (kind / percentOff / specialPriceSgd / sortId / id); the rest are filler so
// the literal type-checks against the Drizzle inferred row.
let seq = 0n
function promo(over: Partial<PromotionRow> & Pick<PromotionRow, 'kind'>): PromotionRow {
  seq += 1n
  return {
    id: `promo-${seq}`,
    tenantId: TENANT_ONE_ID,
    parentType: 'class_package',
    parentId: 'parent-1',
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

// ---------- ordinary case ----------
{
  const p = promo({ kind: 'percent', percentOff: 20 })
  assert.deepStrictEqual(bestPrice('100.00', [p]), {
    effectivePriceSgd: '80.00',
    appliedPromotionId: p.id,
  })
}
{
  const p = promo({ kind: 'special_price', specialPriceSgd: '88.00' })
  assert.deepStrictEqual(bestPrice('120.00', [p]), {
    effectivePriceSgd: '88.00',
    appliedPromotionId: p.id,
  })
}

// ---------- no promotion applies ----------
// empty list
assert.deepStrictEqual(bestPrice('100.00', []), {
  effectivePriceSgd: '100.00',
  appliedPromotionId: null,
})
// base price string is normalised to 2dp even with no promo
assert.deepStrictEqual(bestPrice('100', []), {
  effectivePriceSgd: '100.00',
  appliedPromotionId: null,
})
// a promo that is not cheaper than base is skipped (`price >= base` guard)
assert.deepStrictEqual(bestPrice('100.00', [promo({ kind: 'special_price', specialPriceSgd: '100.00' })]), {
  effectivePriceSgd: '100.00',
  appliedPromotionId: null,
})
assert.deepStrictEqual(bestPrice('100.00', [promo({ kind: 'special_price', specialPriceSgd: '150.00' })]), {
  effectivePriceSgd: '100.00',
  appliedPromotionId: null,
})
// malformed rows (kind/value mismatch) are skipped, not thrown on
assert.deepStrictEqual(bestPrice('100.00', [promo({ kind: 'percent', percentOff: null })]), {
  effectivePriceSgd: '100.00',
  appliedPromotionId: null,
})
assert.deepStrictEqual(bestPrice('100.00', [promo({ kind: 'special_price', specialPriceSgd: null })]), {
  effectivePriceSgd: '100.00',
  appliedPromotionId: null,
})

// ---------- expired / out-of-window promotion ----------
// CURRENT BEHAVIOUR (possible defect): bestPrice never looks at startsAt/endsAt.
// Window filtering lives only in listActivePromotionsFor's SQL. Any caller that
// passes an unfiltered set — e.g. the portal admin serializers, which feed
// listManagedPromotionsFor (deliberately window-agnostic) straight into
// bestPrice — gets expired and not-yet-started promos applied to the price.
{
  const expired = promo({
    kind: 'percent',
    percentOff: 50,
    startsAt: new Date('2020-01-01T00:00:00Z'),
    endsAt: new Date('2020-02-01T00:00:00Z'),
  })
  assert.deepStrictEqual(bestPrice('100.00', [expired]), {
    effectivePriceSgd: '50.00',
    appliedPromotionId: expired.id,
  })
}
{
  const future = promo({
    kind: 'special_price',
    specialPriceSgd: '10.00',
    startsAt: new Date('2099-01-01T00:00:00Z'),
    endsAt: new Date('2099-02-01T00:00:00Z'),
  })
  assert.deepStrictEqual(bestPrice('100.00', [future]), {
    effectivePriceSgd: '10.00',
    appliedPromotionId: future.id,
  })
}
// Same for an archived row — status is not consulted either.
{
  const archived = promo({ kind: 'percent', percentOff: 30, status: 'archived' })
  assert.deepStrictEqual(bestPrice('100.00', [archived]), {
    effectivePriceSgd: '70.00',
    appliedPromotionId: archived.id,
  })
}

// ---------- discount larger than the base price ----------
// CURRENT BEHAVIOUR (possible defect): there is NO floor at zero. A special
// price below zero, or a percentOff above 100, produces a negative charge.
// The admin write path (routes/portal/admin/*: priceField rejects n < 0, and
// the DB check constraint pins percent_off to 1..99) is the only thing keeping
// this unreachable today — bestPrice itself does not defend.
{
  const p = promo({ kind: 'special_price', specialPriceSgd: '-10.00' })
  assert.deepStrictEqual(bestPrice('100.00', [p]), {
    effectivePriceSgd: '-10.00',
    appliedPromotionId: p.id,
  })
}
{
  const p = promo({ kind: 'percent', percentOff: 150 })
  assert.deepStrictEqual(bestPrice('100.00', [p]), {
    effectivePriceSgd: '-50.00',
    appliedPromotionId: p.id,
  })
}
// Exactly free is fine and does apply.
{
  const p = promo({ kind: 'special_price', specialPriceSgd: '0.00' })
  assert.deepStrictEqual(bestPrice('100.00', [p]), {
    effectivePriceSgd: '0.00',
    appliedPromotionId: p.id,
  })
}
// ...but on a base of 0 nothing can win (0 >= 0), so a free package reports no promo.
assert.deepStrictEqual(bestPrice('0.00', [promo({ kind: 'special_price', specialPriceSgd: '0.00' })]), {
  effectivePriceSgd: '0.00',
  appliedPromotionId: null,
})

// ---------- best price wins across several ----------
{
  const a = promo({ kind: 'percent', percentOff: 10 })
  const b = promo({ kind: 'special_price', specialPriceSgd: '70.00' })
  const c = promo({ kind: 'percent', percentOff: 20 })
  assert.strictEqual(bestPrice('100.00', [a, b, c]).appliedPromotionId, b.id)
  assert.strictEqual(bestPrice('100.00', [c, b, a]).appliedPromotionId, b.id)
  assert.strictEqual(bestPrice('100.00', [a, b, c]).effectivePriceSgd, '70.00')
}

// ---------- tie-break: two promotions land on the same price ----------
// Lowest sort_id wins (fe-client-features.md §6.1), independent of array order.
{
  const late = promo({ kind: 'percent', percentOff: 50, sortId: 9n })
  const early = promo({ kind: 'special_price', specialPriceSgd: '50.00', sortId: 3n })
  assert.strictEqual(bestPrice('100.00', [late, early]).appliedPromotionId, early.id)
  assert.strictEqual(bestPrice('100.00', [early, late]).appliedPromotionId, early.id)
  assert.strictEqual(bestPrice('100.00', [late, early]).effectivePriceSgd, '50.00')
}
// Three-way tie also resolves to the lowest sort_id.
{
  const a = promo({ kind: 'special_price', specialPriceSgd: '50.00', sortId: 8n })
  const b = promo({ kind: 'special_price', specialPriceSgd: '50.00', sortId: 2n })
  const c = promo({ kind: 'percent', percentOff: 50, sortId: 5n })
  assert.strictEqual(bestPrice('100.00', [a, b, c]).appliedPromotionId, b.id)
  assert.strictEqual(bestPrice('100.00', [c, a, b]).appliedPromotionId, b.id)
}

// ---------- tie-break vs float noise (possible defect) ----------
// The tie-break compares UNROUNDED floats, but the price the member sees is
// rounded to 2dp. 50.00 * (1 - 34/100) === 32.99999999999999, which renders as
// "33.00". Against a special_price of "33.00" with a LOWER sort_id the two are
// the same advertised price, so §6.1 says the low sort_id wins — but the float
// is strictly smaller, so the percent promo wins instead and sort_id never
// gets a say. Asserting the ACTUAL behaviour here.
{
  const percentHighSort = promo({ kind: 'percent', percentOff: 34, sortId: 9n })
  const specialLowSort = promo({ kind: 'special_price', specialPriceSgd: '33.00', sortId: 1n })
  const got = bestPrice('50.00', [percentHighSort, specialLowSort])
  assert.strictEqual(got.effectivePriceSgd, '33.00')
  assert.strictEqual(got.appliedPromotionId, percentHighSort.id) // spec would say specialLowSort.id
}

// ---------- percent rounding (possible defect at sub-$2 prices) ----------
// base * (1 - pct/100) then toFixed(2) is binary float rounding, not decimal
// half-up. 1.05 * 0.70 === 0.735 but toFixed gives "0.73" (half-up = 0.74).
// Only bites at very small prices — a sweep of $50.00..$500.00 in $5 steps
// against every percentOff 1..99 found no mismatch, so no live package is
// affected today.
{
  const p = promo({ kind: 'percent', percentOff: 30 })
  assert.strictEqual(bestPrice('1.05', [p]).effectivePriceSgd, '0.73')
}
{
  const p = promo({ kind: 'percent', percentOff: 90 })
  assert.strictEqual(bestPrice('1.15', [p]).effectivePriceSgd, '0.11')
}

console.log('promotions.test ok')
