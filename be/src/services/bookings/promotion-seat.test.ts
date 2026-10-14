import assert from 'node:assert'
import { test } from 'node:test'
import { seatFor, type SeatCapacities, type SeatCounts } from './seats'

/**
 * Staff "Add to class" on a waitlist row (spec-waitlist.md §7) takes the seat
 * any staff booking takes (`seatFor`): the member the line was holding a place
 * for takes a freed online seat first, then a buffer seat, then — for an admin
 * who asked — an overbook seat.
 */
const CAPS: SeatCapacities = { capacityOnline: 10, capacityBuffer: 2 }

const counts = (over: Partial<SeatCounts> = {}): SeatCounts => {
  const c = { onlineUsed: 0, bufferUsed: 0, overbookUsed: 0, ...over }
  return { ...c, attending: c.onlineUsed + c.bufferUsed + c.overbookUsed }
}

test('WTL-19 Add to class takes a free online seat before the buffer', () => {
  assert.deepStrictEqual(seatFor(counts({ onlineUsed: 9 }), CAPS, 'instructor', false), {
    ok: true,
    seat: 'online',
  })
})

test('WTL-19 Add to class takes a buffer seat once the online seats are gone', () => {
  assert.deepStrictEqual(seatFor(counts({ onlineUsed: 10, bufferUsed: 1 }), CAPS, 'instructor', false), {
    ok: true,
    seat: 'buffer',
  })
})

test('WTL-19 Add to class into a full room is refused unless an admin overbooks', () => {
  const full = counts({ onlineUsed: 10, bufferUsed: 2 })
  assert.deepStrictEqual(seatFor(full, CAPS, 'admin', false), { ok: false, refusal: 'class_full' })
  assert.deepStrictEqual(seatFor(full, CAPS, 'admin', true), { ok: true, seat: 'overbook' })
  assert.deepStrictEqual(seatFor(full, CAPS, 'instructor', true), { ok: false, refusal: 'class_full' })
})

test('an overbook flag never skips a free seat', () => {
  assert.deepStrictEqual(seatFor(counts(), CAPS, 'admin', true), { ok: true, seat: 'online' })
})
