import assert from 'node:assert'
import { planPtTypeChange, ptSessionCost } from './cost'

// --- the rule itself ---------------------------------------------------------
assert.strictEqual(ptSessionCost('1on1'), 1)
assert.strictEqual(ptSessionCost('2on1'), 2)

// --- upgrade: one extra credit leaves the balance, partner joins -------------
assert.deepStrictEqual(planPtTypeChange('1on1', '2on1', 5), {
  delta: -1,
  partner: 'add',
  refusal: null,
})

// --- downgrade: the extra credit comes back, partner leaves ------------------
assert.deepStrictEqual(planPtTypeChange('2on1', '1on1', 0), {
  delta: 1,
  partner: 'remove',
  refusal: null,
})

// --- no change: no movement, no partner churn, never a double debit ----------
assert.deepStrictEqual(planPtTypeChange('2on1', '2on1', 0), {
  delta: 0,
  partner: 'none',
  refusal: null,
})
assert.deepStrictEqual(planPtTypeChange('1on1', '1on1', 0), {
  delta: 0,
  partner: 'none',
  refusal: null,
})

// --- balance short: refused, and the delta is still reported ------------------
assert.deepStrictEqual(planPtTypeChange('1on1', '2on1', 0), {
  delta: -1,
  partner: 'add',
  refusal: 'insufficient_credits',
})
// exactly enough is NOT short
assert.strictEqual(planPtTypeChange('1on1', '2on1', 1).refusal, null)
// unlimited (null) is refused rather than treated as bottomless
assert.strictEqual(planPtTypeChange('1on1', '2on1', null).refusal, 'insufficient_credits')
// a refund never refuses, however empty the package is
assert.strictEqual(planPtTypeChange('2on1', '1on1', null).refusal, null)

console.log('pt-sessions/cost.test ok')
