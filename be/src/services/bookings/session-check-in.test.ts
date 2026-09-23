import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionCheckInState } from './session-check-in'

test('CHK-07 a roster with any undecided row is pending', () => {
  assert.equal(sessionCheckInState(['attended', 'pending', 'no_show']), 'pending')
  assert.equal(sessionCheckInState(['pending']), 'pending')
  assert.equal(sessionCheckInState(['attended', null]), 'pending', 'a PT attendee with no booking row is undecided')
})

test('CHK-07 a roster whose every row is attended or no-show is completed', () => {
  assert.equal(sessionCheckInState(['attended', 'no_show']), 'completed')
  assert.equal(sessionCheckInState(['no_show']), 'completed')
})

test('an empty roster has nobody left to decide', () => {
  assert.equal(sessionCheckInState([]), 'completed')
})
