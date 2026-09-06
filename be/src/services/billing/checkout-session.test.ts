import test from 'node:test'
import assert from 'node:assert/strict'

import { purchaseKindFor, totalCents } from './checkout-session'
import { AppError } from '../../shared/errors'

test('the Purchase kind is read off the same field the webhook dispatches on', () => {
  assert.equal(purchaseKindFor({ kind: 'class_package' }), 'class_package')
  assert.equal(purchaseKindFor({ kind: 'pt_package' }), 'pt_package')
  assert.equal(purchaseKindFor({ kind: 'workshop' }), 'workshop')
  assert.equal(purchaseKindFor({ kind: 'merch' }), 'merch')
  assert.equal(purchaseKindFor({ kind: 'cross_location_add_on' }), 'cross_location_add_on')
})

test('a kind nothing could grant is refused rather than becoming a meaningless Purchase', () => {
  assert.throws(() => purchaseKindFor({}), (err: unknown) => {
    assert.ok(err instanceof AppError)
    assert.equal(err.code, 'checkout_kind_unknown')
    return true
  })
  assert.throws(() => purchaseKindFor({ kind: 'corporate_package' }), AppError)
})

test('the total is what the lines add up to — the plan and its Add-On together', () => {
  assert.equal(totalCents([]), 0)
  assert.equal(
    totalCents([
      { name: 'Unlimited 3 months', description: '', amountCents: 500_00 },
      { name: 'Cross-Location Add-On', description: '', amountCents: 90_00 },
    ]),
    590_00,
  )
})
