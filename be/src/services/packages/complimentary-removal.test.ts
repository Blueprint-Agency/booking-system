import assert from 'node:assert'
import { removalRefusal, type ComplimentaryBooking } from './complimentary-removal'

// The rule this module exists to hold: a Complimentary Package is removable
// while it is Untouched, and a class that has been held is what ends that.

const NOW = new Date('2026-06-10T10:00:00Z')
const earlier = new Date('2026-06-10T08:00:00Z')
const later = new Date('2026-06-12T08:00:00Z')

const booking = (b: Partial<ComplimentaryBooking>): ComplimentaryBooking => ({
  state: 'confirmed',
  checkInState: 'pending',
  startsAt: later,
  ...b,
})

assert.strictEqual(
  removalRefusal([], NOW),
  null,
  'a Dormant comp nobody has booked with is removable',
)

assert.strictEqual(
  removalRefusal([booking({})], NOW),
  null,
  'a class it paid for that has not been held yet leaves it removable — removing simply cancels it',
)

assert.strictEqual(
  removalRefusal([booking({ checkInState: 'attended' })], NOW),
  'package_touched',
  'a class it paid for that was attended is what removing would rewrite',
)

assert.strictEqual(
  removalRefusal([booking({ checkInState: 'no_show', startsAt: earlier })], NOW),
  'package_touched',
  'a no-show counts as used — the class ran and the seat was held',
)

assert.strictEqual(
  removalRefusal([booking({ startsAt: earlier })], NOW),
  'package_touched',
  'a class that has already started is held, whatever the roster says later',
)

assert.strictEqual(
  removalRefusal([booking({ state: 'cancelled', startsAt: earlier })], NOW),
  null,
  'a cancelled booking is not a class anybody sat in',
)

assert.strictEqual(
  removalRefusal([booking({}), booking({ checkInState: 'attended' })], NOW),
  'package_touched',
  'one held class out of several is enough',
)

assert.strictEqual(
  removalRefusal([booking({ startsAt: null })], NOW),
  null,
  'a booking with no session to have started cannot have been held',
)
