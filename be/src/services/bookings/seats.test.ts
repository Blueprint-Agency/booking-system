import assert from 'node:assert'
import { test } from 'node:test'
import { attendanceCapacity, seatFor, spotsLeft, type SeatCapacities, type SeatCounts } from './seats'

/** 10 online seats, 2 buffer seats, a line of 5 — the spec's worked example. */
const CAPS: SeatCapacities = { capacityOnline: 10, capacityBuffer: 2 }

const counts = (over: Partial<SeatCounts> = {}): SeatCounts => {
  const c = { onlineUsed: 0, bufferUsed: 0, overbookUsed: 0, ...over }
  return { ...c, attending: c.onlineUsed + c.bufferUsed + c.overbookUsed }
}

test('a member takes an online seat while one is free', () => {
  assert.deepStrictEqual(seatFor(counts({ onlineUsed: 9 }), CAPS, 'member', false), { ok: true, seat: 'online' })
})

test('a member is refused once the online seats are gone, even with the buffer empty', () => {
  assert.deepStrictEqual(seatFor(counts({ onlineUsed: 10 }), CAPS, 'member', false), {
    ok: false,
    refusal: 'class_full',
  })
})

test('a member cannot overbook', () => {
  assert.deepStrictEqual(seatFor(counts({ onlineUsed: 10 }), CAPS, 'member', true), {
    ok: false,
    refusal: 'class_full',
  })
})

test('SEAT-01 staff take a buffer seat, not an online one, while the buffer has room', () => {
  for (const role of ['admin', 'instructor'] as const) {
    assert.deepStrictEqual(seatFor(counts(), CAPS, role, false), { ok: true, seat: 'buffer' })
    assert.deepStrictEqual(seatFor(counts({ onlineUsed: 10, bufferUsed: 1 }), CAPS, role, false), {
      ok: true,
      seat: 'buffer',
    })
  }
})

test('SEAT-02 a full buffer refuses staff unless an admin asks to overbook', () => {
  const full = counts({ onlineUsed: 10, bufferUsed: 2 })
  assert.deepStrictEqual(seatFor(full, CAPS, 'admin', false), { ok: false, refusal: 'class_full' })
  assert.deepStrictEqual(seatFor(full, CAPS, 'admin', true), { ok: true, seat: 'overbook' })
  assert.deepStrictEqual(seatFor(full, CAPS, 'instructor', true), { ok: false, refusal: 'class_full' })
})

test('overbooking is only for a full buffer: an admin asking with room left still gets a buffer seat', () => {
  assert.deepStrictEqual(seatFor(counts({ bufferUsed: 1 }), CAPS, 'admin', true), { ok: true, seat: 'buffer' })
})

test('a class with no buffer sends staff straight to the overbook question', () => {
  const none: SeatCapacities = { capacityOnline: 10, capacityBuffer: 0 }
  assert.deepStrictEqual(seatFor(counts(), none, 'instructor', false), { ok: false, refusal: 'class_full' })
  assert.deepStrictEqual(seatFor(counts(), none, 'admin', true), { ok: true, seat: 'overbook' })
})

test('a capacity lowered under the seats already held still reads as full, never negative', () => {
  const shrunk: SeatCapacities = { capacityOnline: 3, capacityBuffer: 1 }
  const held = counts({ onlineUsed: 5, bufferUsed: 2 })
  assert.deepStrictEqual(seatFor(held, shrunk, 'member', false), { ok: false, refusal: 'class_full' })
  assert.deepStrictEqual(seatFor(held, shrunk, 'admin', false), { ok: false, refusal: 'class_full' })
  assert.strictEqual(spotsLeft(held, shrunk), 0)
})

test('spots left counts online seats only: buffer and overbook bookings never touch it', () => {
  assert.strictEqual(spotsLeft(counts({ onlineUsed: 3, bufferUsed: 2, overbookUsed: 4 }), CAPS), 7)
})

test('SCH-04 attendance capacity is online plus buffer; the waitlist is not a seat', () => {
  assert.strictEqual(attendanceCapacity({ capacityOnline: 10, capacityBuffer: 2 }), 12)
})
