import assert from 'node:assert'
import { overlaps, occupies, conflictMessage, leaveConflicts, leaveDaysPhrase } from './occupancy'

/** `at('09:00-10:00')` → a window on 2026-01-01. */
const at = (range: string) => {
  const [from, to] = range.split('-')
  return {
    startsAt: new Date(`2026-01-01T${from}:00Z`),
    endsAt: new Date(`2026-01-01T${to}:00Z`),
  }
}

// --- the overlap rule ---

// touching but not overlapping — a 10:00 class does not clash with a 09:00-10:00 one
assert.strictEqual(overlaps(at('09:00-10:00'), at('10:00-11:00')), false)
assert.strictEqual(overlaps(at('10:00-11:00'), at('09:00-10:00')), false)

// clearly apart
assert.strictEqual(overlaps(at('09:00-10:00'), at('14:00-15:00')), false)

// partial overlap, both directions
assert.strictEqual(overlaps(at('09:00-10:30'), at('10:00-11:00')), true)
assert.strictEqual(overlaps(at('10:00-11:00'), at('09:00-10:30')), true)

// containment, both directions
assert.strictEqual(overlaps(at('09:00-12:00'), at('10:00-11:00')), true)
assert.strictEqual(overlaps(at('10:00-11:00'), at('09:00-12:00')), true)

// identical windows
assert.strictEqual(overlaps(at('10:00-11:00'), at('10:00-11:00')), true)

// zero-length windows: an instant strictly inside a booking is still inside it,
// in both directions...
assert.strictEqual(overlaps(at('10:00-10:00'), at('09:00-11:00')), true)
assert.strictEqual(overlaps(at('09:00-11:00'), at('10:00-10:00')), true)
// ...but two instants never meet, and an instant on either boundary is free
assert.strictEqual(overlaps(at('10:00-10:00'), at('10:00-10:00')), false)
assert.strictEqual(overlaps(at('10:00-10:00'), at('10:00-11:00')), false)
assert.strictEqual(overlaps(at('11:00-11:00'), at('10:00-11:00')), false)

// --- self-exclusion ---

const theClass = { kind: 'class' as const, id: 'c1', ...at('10:00-11:00') }

// with no exclusion it occupies its own window
assert.strictEqual(occupies(theClass, at('10:00-11:00')), true)

// rescheduling itself — same slot, moved slot, overlapping slot: never a conflict
assert.strictEqual(occupies(theClass, at('10:00-11:00'), { kind: 'class', id: 'c1' }), false)
assert.strictEqual(occupies(theClass, at('10:30-11:30'), { kind: 'class', id: 'c1' }), false)

// exclusion is per (kind, id) — a different id, or the same id under another
// kind, still blocks
assert.strictEqual(occupies(theClass, at('10:00-11:00'), { kind: 'class', id: 'c2' }), true)
assert.strictEqual(occupies(theClass, at('10:00-11:00'), { kind: 'pt_session', id: 'c1' }), true)

// every kind can exclude itself, uniformly
for (const kind of ['class', 'workshop_day', 'pt_session', 'corporate_session'] as const) {
  const ev = { kind, id: 'x', ...at('10:00-11:00') }
  assert.strictEqual(occupies(ev, at('10:00-11:00'), { kind, id: 'x' }), false)
  assert.strictEqual(occupies(ev, at('10:00-11:00')), true)
}

// --- leave occupies the instructor's day ---

const leave = [{ id: 'lv1', startDate: '2026-08-12', endDate: '2026-08-12' }]
/** A class at `hh:mm` Singapore time on `day`, one hour long. */
const sgClass = (day: string, hhmm: string) => {
  const startsAt = new Date(`${day}T${hhmm}:00+08:00`)
  return { startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) }
}

// a class at any hour of the leave day clashes — first thing in the morning...
assert.strictEqual(leaveConflicts(leave, sgClass('2026-08-12', '07:00')).length, 1)
// ...and last thing at night, which in UTC is already the next date
assert.strictEqual(leaveConflicts(leave, sgClass('2026-08-12', '23:00')).length, 1)

// the day boundary, from both sides: a class ending exactly as the leave starts
// still runs, and one starting the moment it ends is free
assert.strictEqual(leaveConflicts(leave, sgClass('2026-08-11', '23:00')).length, 0)
assert.strictEqual(leaveConflicts(leave, sgClass('2026-08-13', '00:00')).length, 0)

// nothing on the day, nothing to report
assert.strictEqual(leaveConflicts([], sgClass('2026-08-12', '10:00')).length, 0)

// a run of days occupies the middle ones too, and only them
const run = [{ id: 'lv2', startDate: '2026-08-12', endDate: '2026-08-14' }]
assert.strictEqual(leaveConflicts(run, sgClass('2026-08-13', '10:00')).length, 1)
assert.strictEqual(leaveConflicts(run, sgClass('2026-08-14', '22:00')).length, 1)
assert.strictEqual(leaveConflicts(run, sgClass('2026-08-15', '10:00')).length, 0)

// the payload points at the leave request and spans Singapore midnights
assert.deepStrictEqual(leaveConflicts(run, sgClass('2026-08-13', '10:00')), [
  {
    kind: 'leave',
    id: 'lv2',
    starts_at: '2026-08-11T16:00:00.000Z',
    ends_at: '2026-08-14T16:00:00.000Z',
  },
])

// --- a half day takes only that half of the day ---

const morning = [{ id: 'lv3', startDate: '2026-08-12', endDate: '2026-08-12', halfDay: 'morning' as const }]
const afternoon = [{ id: 'lv4', startDate: '2026-08-12', endDate: '2026-08-12', halfDay: 'afternoon' as const }]

// a 09:00 class is in the morning half, and the afternoon is still bookable
assert.strictEqual(leaveConflicts(morning, sgClass('2026-08-12', '09:00')).length, 1)
assert.strictEqual(leaveConflicts(afternoon, sgClass('2026-08-12', '09:00')).length, 0)

// a 15:00 class is the other way round
assert.strictEqual(leaveConflicts(afternoon, sgClass('2026-08-12', '15:00')).length, 1)
assert.strictEqual(leaveConflicts(morning, sgClass('2026-08-12', '15:00')).length, 0)

// the boundary itself: a class ENDING at 13:00 is morning only...
assert.strictEqual(leaveConflicts(morning, sgClass('2026-08-12', '12:00')).length, 1)
assert.strictEqual(leaveConflicts(afternoon, sgClass('2026-08-12', '12:00')).length, 0)
// ...and one STARTING at 13:00 is afternoon only
assert.strictEqual(leaveConflicts(morning, sgClass('2026-08-12', '13:00')).length, 0)
assert.strictEqual(leaveConflicts(afternoon, sgClass('2026-08-12', '13:00')).length, 1)

// but a class STRADDLING 13:00 (12:30–13:30) is in both halves, so it clashes
// with a morning request and with an afternoon one alike
assert.strictEqual(leaveConflicts(morning, sgClass('2026-08-12', '12:30')).length, 1, 'straddles into the morning')
assert.strictEqual(leaveConflicts(afternoon, sgClass('2026-08-12', '12:30')).length, 1, 'and into the afternoon')

// a half day still cannot reach the days on either side of it
assert.strictEqual(leaveConflicts(morning, sgClass('2026-08-11', '09:00')).length, 0)
assert.strictEqual(leaveConflicts(afternoon, sgClass('2026-08-13', '15:00')).length, 0)

// the payload is the half, not the day
assert.deepStrictEqual(leaveConflicts(afternoon, sgClass('2026-08-12', '15:00')), [
  {
    kind: 'leave',
    id: 'lv4',
    starts_at: '2026-08-12T05:00:00.000Z', // 13:00 SGT
    ends_at: '2026-08-12T16:00:00.000Z',
  },
])

// an omitted marker is a whole day, as every existing caller expects
assert.strictEqual(
  leaveConflicts([{ id: 'lv5', startDate: '2026-08-12', endDate: '2026-08-12', halfDay: 'none' }], sgClass('2026-08-12', '15:00'))
    .length,
  1,
)

// --- the refusal sentence ---

const conflict = (kind: 'class' | 'workshop_day' | 'pt_session' | 'corporate_session') => ({
  kind,
  id: 'e1',
  // 10:00-11:00 UTC is 18:00-19:00 in Singapore — the clock an admin reads.
  starts_at: '2026-01-01T10:00:00.000Z',
  ends_at: '2026-01-01T11:00:00.000Z',
})

// names the subject, the conflicting event, and its window in studio time
assert.strictEqual(
  conflictMessage('Anya', [conflict('class')]),
  'Anya is already booked — a class on 1 Jan, 18:00–19:00.',
)

// a room reads the same way; the caller supplies the label
assert.match(conflictMessage('Room Studio A', [conflict('pt_session')]), /^Room Studio A is already/)

// each kind gets a word an admin recognises, never the enum spelling
assert.match(conflictMessage('Anya', [conflict('workshop_day')]), /a workshop day on/)
assert.match(conflictMessage('Anya', [conflict('pt_session')]), /a private session on/)
assert.match(conflictMessage('Anya', [conflict('corporate_session')]), /a corporate session on/)

// more than one clash: name the first, count the rest
assert.match(conflictMessage('Anya', [conflict('class'), conflict('pt_session')]), /\(and 1 more\)\.$/)

// defensive — never claim a conflict with nothing to point at
assert.strictEqual(conflictMessage('Anya', []), 'Anya is not available at that time.')

// someone away is on leave, not "already booked", and a whole day has no clock
const onLeave = (from: string, to: string) => ({ kind: 'leave' as const, id: 'lv1', starts_at: from, ends_at: to })
assert.strictEqual(
  conflictMessage('Anya', [onLeave('2026-08-11T16:00:00.000Z', '2026-08-12T16:00:00.000Z')]),
  'Anya is on leave on 12 Aug.',
)
// a run names both ends — the last day it covers, not the midnight after it
assert.strictEqual(
  conflictMessage('Anya', [onLeave('2026-08-11T16:00:00.000Z', '2026-08-14T16:00:00.000Z')]),
  'Anya is on leave from 12 Aug to 14 Aug.',
)

// the days phrase on its own — the leave submission refusal is built from it
assert.strictEqual(
  leaveDaysPhrase({ starts_at: '2026-08-11T16:00:00.000Z', ends_at: '2026-08-12T16:00:00.000Z' }),
  'on 12 Aug',
)
assert.strictEqual(
  leaveDaysPhrase({ starts_at: '2026-08-11T16:00:00.000Z', ends_at: '2026-08-14T16:00:00.000Z' }),
  'from 12 Aug to 14 Aug',
)
// a half day is still one day, named once
assert.strictEqual(
  leaveDaysPhrase({ starts_at: '2026-08-12T05:00:00.000Z', ends_at: '2026-08-12T16:00:00.000Z' }),
  'on 12 Aug',
)

console.log('occupancy.test ok')
