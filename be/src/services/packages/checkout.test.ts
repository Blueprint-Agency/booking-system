import assert from 'node:assert'
import { purchaseLines } from './checkout'
import { toCents } from '../../shared/money'

// The money rule this module exists to hold (§5, story 96): the plan line is the
// only thing a discount can touch, the Add-On line is charged at the Global
// Policy rate whatever happened to the plan, and the two together ARE the charge.

// The studio doing the selling. Any name will do here EXCEPT a real one: the
// point of the argument is that the module has no studio of its own to fall
// back to, so the test names an obviously invented one.
const STUDIO = 'Test Studio'

const plan = { planName: 'Unlimited 3 Months', studioName: STUDIO, planSgd: '300.00' }

// --- plan alone ---

const alone = purchaseLines({ ...plan, crossLocationSgd: null })
assert.strictEqual(alone.totalCents, 30000)
assert.strictEqual(alone.lines.length, 1, 'no Add-On bought, no Add-On line')

// --- plan plus Add-On: two lines, never folded into one (§15) ---

const both = purchaseLines({ ...plan, crossLocationSgd: '60.00' })
assert.strictEqual(both.lines.length, 2)
assert.strictEqual(both.lines[1]!.amountCents, 6000)
assert.strictEqual(both.totalCents, 36000, 'plan plus Add-On is the charge')

// --- a code that zeroes the plan still leaves the Add-On charged ---

const discounted = purchaseLines({
  planName: plan.planName,
  studioName: STUDIO,
  planSgd: '0.00',
  crossLocationSgd: '60.00',
  promoCode: 'FREEPLAN',
})
assert.strictEqual(discounted.totalCents, 6000, 'the Add-On is never discounted')
assert.deepStrictEqual(
  discounted.lines.map(l => l.amountCents),
  [6000],
  'a zero plan line is dropped — Stripe refuses one, the Add-On still charges',
)
assert.strictEqual(discounted.planCents, 0)

// --- nothing left to charge at all: the caller grants instead of charging ---

assert.strictEqual(
  purchaseLines({ ...plan, planSgd: '0.00', crossLocationSgd: null }).totalCents,
  0,
)

// --- the code the member typed is named on the line they paid for ---

assert.match(
  purchaseLines({ ...plan, crossLocationSgd: null, promoCode: 'WELCOME10' }).lines[0]!.description,
  /promo WELCOME10 applied/,
)

// --- the line names the STUDIO, not the platform (#66) ---
//
// This is what a member reads on the checkout page and later on a card
// statement, so a second tenant's charge has to say the second tenant's name.
// A shared string here is a chargeback for whichever studio didn't earn it.
assert.match(alone.lines[0]!.description, /^Test Studio/)
assert.match(
  purchaseLines({ ...plan, studioName: 'Second Studio', crossLocationSgd: null }).lines[0]!
    .description,
  /^Second Studio/,
)

// --- money is integer cents, never float arithmetic ---

assert.strictEqual(toCents('0.07'), 7)
assert.strictEqual(toCents('120.10'), 12010)

console.log('checkout.test.ts ok')
