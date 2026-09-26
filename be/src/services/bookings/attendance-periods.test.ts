import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { attendancePlan, attendedWithin, bucketCounts } from './attendance-periods'

// A Saturday.
const TODAY = '2026-09-26'

describe('attendancePlan', () => {
  test('month: the calendar month, in Monday weeks, the first clipped to the 1st', () => {
    const plan = attendancePlan('month', TODAY, null)
    assert.equal(plan.from, '2026-09-01')
    assert.equal(plan.to, '2026-09-30')
    // 1 September is a Tuesday.
    assert.deepEqual(plan.buckets, ['2026-09-01', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'])
    assert.deepEqual(plan.previous, { from: '2026-08-01', to: '2026-08-31' })
  })

  test('month: a month that starts on a Monday has no clipped week', () => {
    const plan = attendancePlan('month', '2026-06-18', null)
    assert.deepEqual(plan.buckets, ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29'])
    assert.equal(plan.to, '2026-06-30')
  })

  test('month: February in a leap year ends on the 29th, and January compares with December', () => {
    assert.equal(attendancePlan('month', '2028-02-10', null).to, '2028-02-29')
    assert.deepEqual(attendancePlan('month', '2026-01-05', null).previous, { from: '2025-12-01', to: '2025-12-31' })
  })

  test('quarter: this month and the two before, weekly, against the three months before that', () => {
    const plan = attendancePlan('quarter', TODAY, null)
    assert.equal(plan.from, '2026-07-01')
    assert.equal(plan.to, '2026-09-30')
    assert.equal(plan.buckets[0], '2026-07-01')
    assert.equal(plan.buckets[1], '2026-07-06')
    assert.equal(plan.buckets.at(-1), '2026-09-28')
    assert.equal(plan.buckets.length, 14)
    assert.deepEqual(plan.previous, { from: '2026-04-01', to: '2026-06-30' })
  })

  test('quarter: crosses the year boundary', () => {
    const plan = attendancePlan('quarter', '2026-01-15', null)
    assert.equal(plan.from, '2025-11-01')
    assert.equal(plan.to, '2026-01-31')
    assert.deepEqual(plan.previous, { from: '2025-08-01', to: '2025-10-31' })
  })

  test('year: the calendar year, one bucket per month, against last year', () => {
    const plan = attendancePlan('year', TODAY, null)
    assert.equal(plan.from, '2026-01-01')
    assert.equal(plan.to, '2026-12-31')
    assert.equal(plan.buckets.length, 12)
    assert.equal(plan.buckets[0], '2026-01-01')
    assert.equal(plan.buckets[11], '2026-12-01')
    assert.deepEqual(plan.previous, { from: '2025-01-01', to: '2025-12-31' })
  })

  test('all: one bucket per year from the first attended class, with nothing to compare against', () => {
    const plan = attendancePlan('all', TODAY, '2024-03-15')
    assert.equal(plan.from, '2024-03-15')
    assert.equal(plan.to, '2026-12-31')
    assert.deepEqual(plan.buckets, ['2024-03-15', '2025-01-01', '2026-01-01'])
    assert.equal(plan.previous, null)
  })

  test('all: a member who has attended nothing gets this year alone', () => {
    const plan = attendancePlan('all', TODAY, null)
    assert.equal(plan.from, '2026-01-01')
    assert.deepEqual(plan.buckets, ['2026-01-01'])
    assert.equal(plan.previous, null)
  })
})

describe('bucketCounts', () => {
  const plan = attendancePlan('month', TODAY, null)

  test('each day lands in the week it falls in; a Sunday closes its week and a Monday opens the next', () => {
    const counts = bucketCounts(plan, [
      { day: '2026-09-01', attended: 1 },
      { day: '2026-09-06', attended: 2 }, // Sunday: still the first week
      { day: '2026-09-07', attended: 1 }, // Monday: the second
      { day: '2026-09-30', attended: 3 },
    ])
    assert.deepEqual(counts, [
      { startsOn: '2026-09-01', attended: 3 },
      { startsOn: '2026-09-07', attended: 1 },
      { startsOn: '2026-09-14', attended: 0 },
      { startsOn: '2026-09-21', attended: 0 },
      { startsOn: '2026-09-28', attended: 3 },
    ])
  })

  test('days outside the period are left out, in whatever order they come', () => {
    const counts = bucketCounts(plan, [
      { day: '2026-10-01', attended: 5 },
      { day: '2026-09-15', attended: 1 },
      { day: '2026-08-31', attended: 4 },
    ])
    assert.deepEqual(
      counts.map(b => b.attended),
      [0, 0, 1, 0, 0],
    )
  })
})

describe('attendedWithin', () => {
  test('sums the days in a span, both ends included', () => {
    const days = [
      { day: '2026-07-31', attended: 9 },
      { day: '2026-08-01', attended: 1 },
      { day: '2026-08-31', attended: 2 },
      { day: '2026-09-01', attended: 7 },
    ]
    assert.equal(attendedWithin({ from: '2026-08-01', to: '2026-08-31' }, days), 3)
    assert.equal(attendedWithin({ from: '2026-01-01', to: '2026-01-31' }, days), 0)
  })
})
