import assert from 'node:assert'
import { describe, test } from 'node:test'
import { descriptorSuffix } from './stripe'

const MAX = 22

describe('statement descriptor suffix', () => {
  test('a studio name that fits is sent as it stands', () => {
    // 'RSVT' + '* ' leaves 16 characters.
    assert.equal(descriptorSuffix('RSVT', 'Acme Yoga'), 'Acme Yoga')
  })

  test('a longer name is cut to what the prefix leaves, never past 22 in total', () => {
    const suffix = descriptorSuffix('RSVT', 'The Very Long Studio Name Company')
    assert.ok(suffix)
    assert.ok('RSVT'.length + 2 + suffix.length <= MAX)
  })

  test('characters Stripe refuses are dropped rather than sent', () => {
    assert.equal(descriptorSuffix('RSVT', 'Yoga <Sadhana>* "SG"'), 'Yoga Sadhana SG')
  })

  test('a name with no letters left is no suffix at all', () => {
    assert.equal(descriptorSuffix('RSVT', '***'), undefined)
  })

  test('no prefix configured means no suffix — Stripe refuses one without it', () => {
    assert.equal(descriptorSuffix(undefined, 'Acme Yoga'), undefined)
    assert.equal(descriptorSuffix('', 'Acme Yoga'), undefined)
  })

  test('a prefix that fills the limit leaves no room, and is not crowded', () => {
    assert.equal(descriptorSuffix('A'.repeat(21), 'Acme Yoga'), undefined)
  })
})
