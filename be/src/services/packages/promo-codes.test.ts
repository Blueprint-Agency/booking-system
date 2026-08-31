import assert from 'node:assert'
import {
  CODE_ALPHABET,
  GENERATED_CODE_LENGTH,
  HOLD_MINUTES,
  holdExpiryFrom,
  refusalMessage,
  coversProduct,
  moneyOffFor,
  evaluatePromoCode,
  generateCode,
  isValidCode,
  missingMoneyField,
  normaliseCode,
  occupiesPlace,
  consumedCount,
  usedPlaces,
  type PromoCodeProductRow,
  type PromoCodeRedemptionRow,
  type PromoCodeRow,
} from './promo-codes'

const NOW = new Date('2026-06-01T12:00:00Z')

// Full inferred Drizzle rows from a partial override — same shape as the
// factory in promotions.test.ts.
let seq = 0
function promoCode(over: Partial<PromoCodeRow> = {}): PromoCodeRow {
  seq += 1
  return {
    id: `code-${seq}`,
    tenantId: 'tenant-1',
    code: `SAVE${seq}`,
    label: 'S$20 off',
    kind: 'amount',
    percentOff: null,
    amountOffSgd: '20.00',
    maxRedemptions: null,
    expiresAt: null,
    appliesToAll: true,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    createdByStaffId: 'staff-1',
    ...over,
  }
}

function scopeRow(over: Partial<PromoCodeProductRow> = {}): PromoCodeProductRow {
  return {
    tenantId: null,
    promoCodeId: 'code-1',
    productType: 'class_package',
    productId: 'product-1',
    ...over,
  }
}

let redemptionSeq = 0
function redemption(over: Partial<PromoCodeRedemptionRow> = {}): PromoCodeRedemptionRow {
  redemptionSeq += 1
  return {
    id: `redemption-${redemptionSeq}`,
    tenantId: null,
    promoCodeId: 'code-1',
    clientId: `client-${redemptionSeq}`,
    status: 'consumed',
    heldUntil: new Date('2026-06-01T12:30:00Z'),
    consumedAt: NOW,
    stripePaymentIntentId: 'pi_1',
    discountSgd: '20.00',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

const CLASS_PRODUCT = { productType: 'class_package' as const, productId: 'product-1' }

// ---------- code text: normalisation, format, generation ----------
assert.strictEqual(normaliseCode('  summer25 '), 'SUMMER25')
assert.strictEqual(normaliseCode('\tSummer-25\n'), 'SUMMER-25')
assert.strictEqual(normaliseCode('SUMMER25'), 'SUMMER25')
// Whitespace INSIDE is not stripped — it makes the text invalid, which is the
// honest answer rather than silently inventing a different code.
assert.strictEqual(normaliseCode(' sad hana '), 'SAD HANA')
assert.strictEqual(isValidCode('SAD HANA'), false)

assert.strictEqual(isValidCode('ABC'), true)
assert.strictEqual(isValidCode('A'.repeat(24)), true)
assert.strictEqual(isValidCode('AB'), false) // too short
assert.strictEqual(isValidCode('A'.repeat(25)), false) // too long
assert.strictEqual(isValidCode('SUMMER-25'), true)
assert.strictEqual(isValidCode('summer'), false) // lower case is not the stored form
assert.strictEqual(isValidCode('SUMMER_25'), false) // underscore is not in [A-Z0-9-]

// The alphabet drops the characters that sound alike when read aloud.
for (const banned of ['0', 'O', '1', 'I', 'L']) {
  assert.ok(!CODE_ALPHABET.includes(banned), `alphabet must not contain ${banned}`)
}
for (let i = 0; i < 200; i++) {
  const g = generateCode()
  assert.strictEqual(g.length, GENERATED_CODE_LENGTH)
  assert.ok(isValidCode(g), `${g} must satisfy the stored-format check`)
  for (const ch of g) assert.ok(CODE_ALPHABET.includes(ch), `${ch} is off-alphabet`)
}

// ---------- arithmetic: percent and absolute ----------
assert.strictEqual(moneyOffFor(promoCode({ kind: 'amount', amountOffSgd: '20.00' }), '180.00'), '20.00')
assert.strictEqual(
  moneyOffFor(promoCode({ kind: 'percent', percentOff: 25, amountOffSgd: null }), '180.00'),
  '45.00',
)
assert.strictEqual(
  moneyOffFor(promoCode({ kind: 'percent', percentOff: 1, amountOffSgd: null }), '99.99'),
  '1.00',
)
// A malformed row (kind says percent, no percent) takes nothing off rather than throwing.
assert.strictEqual(
  moneyOffFor(promoCode({ kind: 'percent', percentOff: null, amountOffSgd: null }), '100.00'),
  '0.00',
)

// ---------- the floor at zero ----------
// A $50 code on a $30 product takes $30 off, not $50 — the price floors at zero
// and never goes negative.
{
  const generous = promoCode({ kind: 'amount', amountOffSgd: '50.00' })
  assert.strictEqual(moneyOffFor(generous, '30.00'), '30.00')
  const got = evaluatePromoCode({
    code: generous,
    scope: [],
    redemptions: [],
    clientId: 'client-x',
    product: CLASS_PRODUCT,
    basePriceSgd: '30.00',
    now: NOW,
  })
  assert.deepStrictEqual(got, { ok: true, discountSgd: '30.00', effectivePriceSgd: '0.00' })
}
// Exactly equal is the same story, and a free product stays free.
assert.strictEqual(moneyOffFor(promoCode({ amountOffSgd: '30.00' }), '30.00'), '30.00')
assert.strictEqual(moneyOffFor(promoCode({ amountOffSgd: '30.00' }), '0.00'), '0.00')

// ---------- scope ----------
{
  // Applies to everything: the scope rows are not consulted at all.
  const all = promoCode({ appliesToAll: true })
  assert.strictEqual(coversProduct(all, [], CLASS_PRODUCT), true)
  assert.strictEqual(coversProduct(all, [], { productType: 'workshop', productId: 'w-1' }), true)

  // An explicit list matches only what it names.
  const listed = promoCode({ appliesToAll: false })
  const scope = [
    scopeRow({ productType: 'class_package', productId: 'product-1' }),
    scopeRow({ productType: 'pt_package', productId: 'pt-9' }),
  ]
  assert.strictEqual(coversProduct(listed, scope, CLASS_PRODUCT), true)
  assert.strictEqual(
    coversProduct(listed, scope, { productType: 'pt_package', productId: 'pt-9' }),
    true,
  )
  assert.strictEqual(
    coversProduct(listed, scope, { productType: 'class_package', productId: 'product-2' }),
    false,
  )
  // Same id, wrong type — the pair is the key, not the id.
  assert.strictEqual(
    coversProduct(listed, scope, { productType: 'pt_package', productId: 'product-1' }),
    false,
  )
  assert.strictEqual(coversProduct(listed, [], CLASS_PRODUCT), false)
}
{
  // Scoping is at WORKSHOP level, never workshop tier. The scope row carries
  // the workshop id, so a purchase of any tier of that workshop matches, and a
  // tier id passed in its place matches nothing.
  const listed = promoCode({ appliesToAll: false })
  const scope = [scopeRow({ productType: 'workshop', productId: 'workshop-7' })]
  assert.strictEqual(
    coversProduct(listed, scope, { productType: 'workshop', productId: 'workshop-7' }),
    true,
  )
  assert.strictEqual(
    coversProduct(listed, scope, { productType: 'workshop', productId: 'tier-early-bird' }),
    false,
  )
}

// ---------- used places: a lapsed Hold is free, consumed is taken, refunded is free ----------
{
  const consumed = redemption({ status: 'consumed' })
  const liveHold = redemption({
    status: 'held',
    heldUntil: new Date('2026-06-01T12:30:00Z'),
    consumedAt: null,
  })
  const lapsedHold = redemption({
    status: 'held',
    heldUntil: new Date('2026-06-01T11:30:00Z'),
    consumedAt: null,
  })
  const refunded = redemption({ status: 'refunded' })

  assert.strictEqual(occupiesPlace(consumed, NOW), true)
  assert.strictEqual(occupiesPlace(liveHold, NOW), true)
  assert.strictEqual(occupiesPlace(lapsedHold, NOW), false)
  assert.strictEqual(occupiesPlace(refunded, NOW), false)

  assert.strictEqual(usedPlaces([consumed, liveHold, lapsedHold, refunded], NOW), 2)
  assert.strictEqual(usedPlaces([], NOW), 0)
  assert.strictEqual(usedPlaces([lapsedHold, refunded], NOW), 0)
  // A Hold expiring exactly now has lapsed — the payment session ends with it.
  assert.strictEqual(
    occupiesPlace(redemption({ status: 'held', heldUntil: NOW, consumedAt: null }), NOW),
    false,
  )
}

// ---------- consumed uses: what freezes the terms, and only that ----------
// A place taken and a member who accepted the terms are different questions.
// `usedPlaces` answers the first and counts a live Hold; this answers the
// second and does not — an abandoned checkout must never freeze a live code.
{
  const consumed = redemption({ status: 'consumed' })
  const liveHold = redemption({
    status: 'held',
    heldUntil: new Date('2026-06-01T12:30:00Z'),
    consumedAt: null,
  })
  const lapsedHold = redemption({
    status: 'held',
    heldUntil: new Date('2026-06-01T11:30:00Z'),
    consumedAt: null,
  })
  const refunded = redemption({ status: 'refunded' })

  assert.strictEqual(consumedCount([]), 0)
  assert.strictEqual(consumedCount([consumed]), 1)
  // The whole point of the ticket: neither of these is a use.
  assert.strictEqual(consumedCount([liveHold]), 0)
  assert.strictEqual(consumedCount([lapsedHold]), 0)
  assert.strictEqual(consumedCount([refunded]), 0)
  assert.strictEqual(consumedCount([liveHold, lapsedHold, refunded]), 0)
  assert.strictEqual(consumedCount([consumed, liveHold, lapsedHold, refunded]), 1)

  // A live Hold takes a place without freezing anything — the two counts
  // disagree here on purpose, and that disagreement is the bug being fixed.
  assert.strictEqual(usedPlaces([liveHold], NOW), 1)
  assert.strictEqual(consumedCount([liveHold]), 0)

  // A refunded use keeps its row (story 89) but hands its place back (88) and
  // takes its freeze with it — the sale it recorded no longer stands.
  assert.strictEqual(usedPlaces([refunded], NOW), 0)
  assert.strictEqual(consumedCount([refunded]), 0)
}

// ---------- the five refusals, each returned distinctly ----------
function evaluate(over: Partial<Parameters<typeof evaluatePromoCode>[0]> = {}) {
  return evaluatePromoCode({
    code: promoCode(),
    scope: [],
    redemptions: [],
    clientId: 'client-me',
    product: CLASS_PRODUCT,
    basePriceSgd: '100.00',
    now: NOW,
    ...over,
  })
}

// Unknown and archived collapse into ONE reason. Separating them would turn the
// validation endpoint into a code-guessing oracle.
assert.deepStrictEqual(evaluate({ code: null }), { ok: false, refusal: 'not_recognised' })
assert.deepStrictEqual(evaluate({ code: promoCode({ status: 'archived' }) }), {
  ok: false,
  refusal: 'not_recognised',
})

assert.deepStrictEqual(
  evaluate({ code: promoCode({ expiresAt: new Date('2026-05-31T00:00:00Z') }) }),
  { ok: false, refusal: 'expired' },
)
// A null expiry never expires, and an expiry in the future is fine.
assert.strictEqual(evaluate({ code: promoCode({ expiresAt: null }) }).ok, true)
assert.strictEqual(
  evaluate({ code: promoCode({ expiresAt: new Date('2026-07-01T00:00:00Z') }) }).ok,
  true,
)

assert.deepStrictEqual(
  evaluate({
    code: promoCode({ appliesToAll: false }),
    scope: [scopeRow({ productType: 'pt_package', productId: 'pt-9' })],
  }),
  { ok: false, refusal: 'out_of_scope' },
)

assert.deepStrictEqual(
  evaluate({
    code: promoCode({ maxRedemptions: 2 }),
    redemptions: [
      redemption({ clientId: 'client-a', status: 'consumed' }),
      redemption({ clientId: 'client-b', status: 'consumed' }),
    ],
  }),
  { ok: false, refusal: 'fully_claimed' },
)

assert.deepStrictEqual(
  evaluate({ redemptions: [redemption({ clientId: 'client-me', status: 'consumed' })] }),
  { ok: false, refusal: 'already_redeemed' },
)

// All five reasons are distinct values.
assert.strictEqual(
  new Set(['expired', 'fully_claimed', 'already_redeemed', 'out_of_scope', 'not_recognised']).size,
  5,
)

// ---------- refusal ordering the member can feel ----------
// A member's own live Hold does NOT refuse them. They abandoned a checkout and
// came back: they are standing in that place already, so the retry re-takes
// their own row. Refusing here would lock them out of their own purchase for
// the length of the Hold, on the last place AND on an uncapped code.
assert.strictEqual(
  evaluate({
    code: promoCode({ maxRedemptions: 1 }),
    redemptions: [
      redemption({ clientId: 'client-me', status: 'held', heldUntil: new Date('2026-06-01T12:30:00Z'), consumedAt: null }),
    ],
  }).ok,
  true,
)
// Someone else's live Hold on the last place is what "fully claimed" is for.
assert.deepStrictEqual(
  evaluate({
    code: promoCode({ maxRedemptions: 1 }),
    redemptions: [
      redemption({ clientId: 'client-other', status: 'held', heldUntil: new Date('2026-06-01T12:30:00Z'), consumedAt: null }),
    ],
  }),
  { ok: false, refusal: 'fully_claimed' },
)
// ...and once their own Hold has lapsed they get the place back.
assert.strictEqual(
  evaluate({
    code: promoCode({ maxRedemptions: 1 }),
    redemptions: [
      redemption({ clientId: 'client-me', status: 'held', heldUntil: new Date('2026-06-01T11:30:00Z'), consumedAt: null }),
    ],
  }).ok,
  true,
)
// A refunded row of their own frees the place too — the evidence stays, the claim does not.
assert.strictEqual(
  evaluate({
    code: promoCode({ maxRedemptions: 1 }),
    redemptions: [redemption({ clientId: 'client-me', status: 'refunded' })],
  }).ok,
  true,
)
// An uncapped code is never fully claimed, however many places are taken.
assert.strictEqual(
  evaluate({
    code: promoCode({ maxRedemptions: null }),
    redemptions: Array.from({ length: 50 }, () => redemption({ status: 'consumed' })),
  }).ok,
  true,
)

// ---------- the ordinary case ----------
assert.deepStrictEqual(
  evaluate({ code: promoCode({ kind: 'percent', percentOff: 10, amountOffSgd: null }) }),
  { ok: true, discountSgd: '10.00', effectivePriceSgd: '90.00' },
)

// ---------- a kind names exactly one money field, and it must be there ----------
assert.strictEqual(missingMoneyField({ kind: 'percent', percentOff: 10 }), null)
assert.strictEqual(missingMoneyField({ kind: 'amount', amountOffSgd: '20.00' }), null)
assert.strictEqual(missingMoneyField({ kind: 'percent', amountOffSgd: '20.00' }), 'percent_off_required')
assert.strictEqual(missingMoneyField({ kind: 'amount', percentOff: 10 }), 'amount_off_sgd_required')
// An explicit null is as absent as an omission.
assert.strictEqual(missingMoneyField({ kind: 'percent', percentOff: null }), 'percent_off_required')

// ---------- the member-facing sentence for each refusal ----------
// Four are specific; unknown and archived deliberately share one, or the
// validation endpoint becomes a code-guessing oracle.
assert.strictEqual(refusalMessage('expired', 'Unlimited 6 months'), 'This code has expired')
assert.strictEqual(refusalMessage('fully_claimed', 'Unlimited 6 months'), 'This code has been fully claimed')
assert.strictEqual(refusalMessage('already_redeemed', 'Unlimited 6 months'), "You've already used this code")
assert.strictEqual(
  refusalMessage('out_of_scope', 'Unlimited 6 months'),
  "This code doesn't apply to Unlimited 6 months",
)
assert.strictEqual(refusalMessage('not_recognised', 'Unlimited 6 months'), "We don't recognise that code")
// Only the scope case names the product; the other four read the same whatever
// is being bought.
assert.strictEqual(
  new Set(
    (['expired', 'fully_claimed', 'already_redeemed', 'out_of_scope', 'not_recognised'] as const).map(r =>
      refusalMessage(r, 'A'),
    ),
  ).size,
  5,
)

// ---------- the Hold and the payment session end at the same moment ----------
assert.strictEqual(HOLD_MINUTES, 30)
// 30 minutes plus the round-trip cushion, which the payment session gets too so
// the two end at the same instant.
assert.strictEqual(holdExpiryFrom(NOW).toISOString(), '2026-06-01T12:31:00.000Z')
// A Hold taken now still occupies its place; the same Hold does not once its
// moment has passed. Nothing sweeps it — this predicate is the whole mechanism.
{
  const held = redemption({ status: 'held', heldUntil: holdExpiryFrom(NOW), consumedAt: null })
  assert.strictEqual(occupiesPlace(held, NOW), true)
  assert.strictEqual(occupiesPlace(held, new Date('2026-06-01T12:32:00Z')), false)
}

console.log('promo-codes.test ok')
