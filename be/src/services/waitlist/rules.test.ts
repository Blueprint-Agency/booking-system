import assert from 'node:assert'
import { test } from 'node:test'
import {
  inLine,
  joinRefusal,
  nextToPromote,
  positions,
  waitlistClosesAt,
  waitlistOpen,
  type JoinFacts,
  type LineEntry,
} from './rules'

const HOUR = 3_600_000
const T0 = new Date('2026-10-05T00:00:00Z')
const at = (ms: number) => new Date(T0.getTime() + ms)

const entry = (id: string, joinedMs: number, clientId = `c-${id}`): LineEntry => ({ id, clientId, joinedAt: at(joinedMs) })

/* ── Order and position ─────────────────────────────────────────────── */

test('the line is ordered by join time, then id, whatever order the rows arrive in', () => {
  const rows = [entry('b', 20), entry('c', 10), entry('a', 20)]
  assert.deepStrictEqual(
    inLine(rows).map(e => e.id),
    ['c', 'a', 'b'],
  )
})

test('a position is one plus the entries ahead of it', () => {
  const p = positions([entry('b', 20), entry('c', 10), entry('a', 20)])
  assert.deepStrictEqual([...p.entries()].sort(), [
    ['a', 2],
    ['b', 3],
    ['c', 1],
  ])
})

/* ── Who is promoted next ───────────────────────────────────────────── */

test('the head of the line is promoted first', () => {
  const line = [entry('second', 20), entry('first', 10)]
  assert.equal(nextToPromote(line, new Map())?.id, 'first')
})

test('a member who could not pay is skipped, and the next in line is tried', () => {
  const line = [entry('first', 10), entry('second', 20), entry('third', 30)]
  const outcomes = new Map([['first', 'insufficient_credits' as const]])
  assert.equal(nextToPromote(line, outcomes)?.id, 'second')
})

test('an entry already promoted in this pass is not tried again', () => {
  const line = [entry('first', 10), entry('second', 20)]
  const outcomes = new Map([
    ['first', 'promoted' as const],
    ['second', 'location_not_covered' as const],
  ])
  assert.equal(nextToPromote(line, outcomes), null)
})

test('an empty line promotes nobody', () => {
  assert.equal(nextToPromote([], new Map()), null)
})

/* ── Open, and the window ───────────────────────────────────────────── */

const CLASS = { startsAt: at(48 * HOUR), lifecycle: 'active' as const }

test('the waitlist closes when the Cancellation Window opens', () => {
  assert.deepStrictEqual(waitlistClosesAt(CLASS.startsAt, 12), at(36 * HOUR))
})

test('open: enabled, active, before the window, and room in the line', () => {
  const base = { enabled: true, ...CLASS, windowHours: 12, waiting: 2, capacityWaitlist: 3, now: at(0) }
  assert.equal(waitlistOpen(base), true)
  assert.equal(waitlistOpen({ ...base, enabled: false }), false, 'studio switch off')
  assert.equal(waitlistOpen({ ...base, lifecycle: 'cancelled' }), false, 'class cancelled')
  assert.equal(waitlistOpen({ ...base, now: at(36 * HOUR) }), false, 'inside the window')
  assert.equal(waitlistOpen({ ...base, waiting: 3 }), false, 'line full')
  assert.equal(waitlistOpen({ ...base, capacityWaitlist: 0, waiting: 0 }), false, 'no waitlist on this class')
})

/* ── Joining: refusals in the spec's order (§4) ─────────────────────── */

const canJoin: JoinFacts = {
  enabled: true,
  classActive: true,
  closed: false,
  alreadyBooked: false,
  alreadyWaiting: false,
  onlineFull: true,
  waiting: 0,
  capacityWaitlist: 5,
}

test('a member may join a full class with room in the line', () => {
  assert.equal(joinRefusal(canJoin), null)
})

test('each check refuses on its own', () => {
  assert.equal(joinRefusal({ ...canJoin, enabled: false }), 'waitlist_disabled')
  assert.equal(joinRefusal({ ...canJoin, classActive: false }), 'class_not_found')
  assert.equal(joinRefusal({ ...canJoin, closed: true }), 'waitlist_closed')
  assert.equal(joinRefusal({ ...canJoin, alreadyBooked: true }), 'already_booked')
  assert.equal(joinRefusal({ ...canJoin, alreadyWaiting: true }), 'already_waitlisted')
  assert.equal(joinRefusal({ ...canJoin, onlineFull: false }), 'class_not_full')
  assert.equal(joinRefusal({ ...canJoin, waiting: 5 }), 'waitlist_full')
})

test('the first failing check in the spec’s order is the one reported', () => {
  const everythingWrong: JoinFacts = {
    enabled: false,
    classActive: false,
    closed: true,
    alreadyBooked: true,
    alreadyWaiting: true,
    onlineFull: false,
    waiting: 9,
    capacityWaitlist: 1,
  }
  const order = [
    ['enabled', true, 'class_not_found'],
    ['classActive', true, 'waitlist_closed'],
    ['closed', false, 'already_booked'],
    ['alreadyBooked', false, 'already_waitlisted'],
    ['alreadyWaiting', false, 'class_not_full'],
    ['onlineFull', true, 'waitlist_full'],
  ] as const
  let facts: JoinFacts = everythingWrong
  assert.equal(joinRefusal(facts), 'waitlist_disabled')
  for (const [key, fixed, next] of order) {
    facts = { ...facts, [key]: fixed }
    assert.equal(joinRefusal(facts), next, `after fixing ${key}`)
  }
})
