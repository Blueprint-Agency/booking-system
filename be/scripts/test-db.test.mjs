import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resetRefusal } from './test-db.mjs'

test('--reset drops only a reservetoday-test-* database', () => {
  assert.equal(resetRefusal('reservetoday-test-staging-7', { POSTGRES_DB: 'reservetoday' }), null)
  assert.match(resetRefusal('reservetoday', { POSTGRES_DB: 'reservetoday' }), /reservetoday-test-\*/)
  assert.match(resetRefusal('booking_test', {}), /reservetoday-test-\*/)
  assert.match(resetRefusal('my-reservetoday-test-db', {}), /reservetoday-test-\*/)
  assert.match(resetRefusal('reservetoday-test-', {}), /reservetoday-test-\*/)
})

test('--reset refuses the development database even when it is named like a test one', () => {
  assert.match(
    resetRefusal('reservetoday-test-dev', { POSTGRES_DB: 'reservetoday-test-dev' }),
    /development database/,
  )
})
