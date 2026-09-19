import assert from 'node:assert'
import {
  addDays,
  isoWeekday,
  localDateOf,
  seriesDates,
  seriesOccurrences,
  zonedInstant,
} from './series-dates'

// --- plain-date arithmetic ---

assert.strictEqual(addDays('2026-12-31', 1), '2027-01-01')
assert.strictEqual(addDays('2026-03-01', -1), '2026-02-28')
// 2026-10-05 is a Monday, 2026-10-11 a Sunday (ISO: Monday 1 … Sunday 7)
assert.strictEqual(isoWeekday('2026-10-05'), 1)
assert.strictEqual(isoWeekday('2026-10-11'), 7)

// --- which days a range produces ---

// Every Monday of Oct–Dec 2026: the "Hatha, Mondays, 1 Oct – 31 Dec" example is 13 classes.
const mondays = seriesDates({ weekday: 1, from: '2026-10-01', to: '2026-12-31', excluded: [] })
assert.strictEqual(mondays.length, 13)
assert.strictEqual(mondays[0], '2026-10-05')
assert.strictEqual(mondays[12], '2026-12-28')
assert.ok(mondays.every(d => isoWeekday(d) === 1))

// Both ends are inclusive: a range that starts and ends on the weekday keeps both.
assert.deepStrictEqual(
  seriesDates({ weekday: 1, from: '2026-10-05', to: '2026-10-19', excluded: [] }),
  ['2026-10-05', '2026-10-12', '2026-10-19'],
)

// Excluded dates are left out; an excluded date that is not an occurrence changes nothing.
assert.deepStrictEqual(
  seriesDates({
    weekday: 1,
    from: '2026-10-05',
    to: '2026-10-19',
    excluded: ['2026-10-12', '2026-10-13'],
  }),
  ['2026-10-05', '2026-10-19'],
)

// A range shorter than a week that misses the weekday produces nothing.
assert.deepStrictEqual(
  seriesDates({ weekday: 1, from: '2026-10-06', to: '2026-10-11', excluded: [] }),
  [],
)

// --- local time → instant ---

// Singapore is UTC+8 all year.
assert.strictEqual(
  zonedInstant('2026-10-05', '19:00', 'Asia/Singapore').toISOString(),
  '2026-10-05T11:00:00.000Z',
)
// Sydney is UTC+10 in winter and UTC+11 in summer (DST from 4 Oct 2026).
assert.strictEqual(
  zonedInstant('2026-09-28', '19:00', 'Australia/Sydney').toISOString(),
  '2026-09-28T09:00:00.000Z',
)
assert.strictEqual(
  zonedInstant('2026-10-05', '19:00', 'Australia/Sydney').toISOString(),
  '2026-10-05T08:00:00.000Z',
)
// A local time that crosses UTC midnight lands on the previous UTC day.
assert.strictEqual(
  zonedInstant('2026-10-05', '07:00', 'Asia/Singapore').toISOString(),
  '2026-10-04T23:00:00.000Z',
)

// --- instant → local date ---

assert.strictEqual(localDateOf(new Date('2026-10-04T23:00:00Z'), 'Asia/Singapore'), '2026-10-05')
assert.strictEqual(localDateOf(new Date('2026-10-04T23:00:00Z'), 'UTC'), '2026-10-04')

// --- occurrences: dates at the right local time, across an offset change ---

// Mondays 19:00–20:00 in Sydney over the DST switch: still 19:00 local every week.
const sydney = seriesOccurrences({
  weekday: 1,
  startTime: '19:00',
  endTime: '20:00',
  from: '2026-09-28',
  to: '2026-10-05',
  excluded: [],
  timezone: 'Australia/Sydney',
})
assert.deepStrictEqual(
  sydney.map(o => [o.date, o.startsAt.toISOString(), o.endsAt.toISOString()]),
  [
    ['2026-09-28', '2026-09-28T09:00:00.000Z', '2026-09-28T10:00:00.000Z'],
    ['2026-10-05', '2026-10-05T08:00:00.000Z', '2026-10-05T09:00:00.000Z'],
  ],
)
assert.ok(sydney.every(o => localDateOf(o.startsAt, 'Australia/Sydney') === o.date))
