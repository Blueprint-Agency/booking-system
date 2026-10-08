import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pendingCheckIns, ptSeats, sessionCheckInState } from './session-check-in'

test('CHK-07 the rows still to decide are the pending ones and any PT attendee with no booking row', () => {
  assert.equal(pendingCheckIns(['attended', 'pending', null, 'no_show', 'n_a', 'pending']), 3)
  assert.equal(pendingCheckIns(['attended', 'no_show']), 0)
})

test('a private session seats each member once: their confirmed booking, else their latest, else none', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h))
  const rows = [
    { member: 'a', state: 'cancelled', bookedAt: at(9), checkInState: 'n_a' },
    { member: 'a', state: 'confirmed', bookedAt: at(8), checkInState: 'pending' },
    { member: 'b', state: 'cancelled', bookedAt: at(7), checkInState: 'n_a' },
    { member: 'b', state: 'cancelled', bookedAt: at(10), checkInState: 'n_a' },
    { member: 'c', state: null, bookedAt: null, checkInState: null },
  ]
  const seats = ptSeats(rows, r => r.member)
  assert.deepEqual(
    seats.map(s => [s.member, s.state, s.bookedAt?.getUTCHours() ?? null]),
    [
      ['a', 'confirmed', 8],
      ['b', 'cancelled', 10],
      ['c', null, null],
    ],
  )
})

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
