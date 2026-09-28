import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstClash, type HeldWindow } from './member-time'

/** `at('16:00-17:00')` → a window on 2026-10-01 (UTC). */
const at = (range: string) => {
  const [from, to] = range.split('-')
  return { startsAt: new Date(`2026-10-01T${from}:00Z`), endsAt: new Date(`2026-10-01T${to}:00Z`) }
}

const held = (range: string, over: Partial<HeldWindow> = {}): HeldWindow => ({
  ...at(range),
  bookingId: `b-${range}`,
  kind: 'class',
  eventId: `c-${range}`,
  title: 'Inversion',
  locationName: 'Riverside',
  ...over,
})

test('BKG-37 a booking that overlaps one the member holds clashes with it', () => {
  const four = held('16:00-17:00')
  assert.equal(firstClash([four], at('16:15-17:15')), four)
  // Inside it, around it, or the same hour.
  assert.equal(firstClash([four], at('16:15-16:45')), four)
  assert.equal(firstClash([four], at('15:30-17:30')), four)
  assert.equal(firstClash([four], at('16:00-17:00')), four)
})

test('BKG-38 back-to-back is not a clash: a class ending at 5 and one starting at 5', () => {
  assert.equal(firstClash([held('16:00-17:00')], at('17:00-18:00')), null)
  assert.equal(firstClash([held('17:00-18:00')], at('16:00-17:00')), null)
  assert.equal(firstClash([held('09:00-10:00')], at('16:00-17:00')), null)
})

test('BKG-37 the class being booked never clashes with itself', () => {
  const same = held('16:00-17:00', { eventId: 'the-class' })
  assert.equal(firstClash([same], at('16:00-17:00'), { kind: 'class', id: 'the-class' }), null)
  // The exclusion is by kind and id: a PT session sharing an id is still held.
  const pt = held('16:00-17:00', { kind: 'pt', eventId: 'the-class' })
  assert.equal(firstClash([pt], at('16:00-17:00'), { kind: 'class', id: 'the-class' }), pt)
})

test('BKG-41 private sessions and workshop days clash as classes do, earliest first', () => {
  const workshopDay = held('16:30-18:00', { kind: 'workshop', title: 'Arm balance weekend' })
  const pt = held('16:10-16:40', { kind: 'pt', title: 'Private session' })
  assert.equal(firstClash([workshopDay, pt], at('16:00-17:00')), pt)
})
