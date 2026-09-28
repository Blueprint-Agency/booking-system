import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  anchorRefusal,
  attendancePlan,
  attendedWithin,
  bucketCounts,
  longestRunWeeks,
  periodSteps,
  streakWeeks,
  usualSlot,
} from './attendance-periods'

// A Saturday.
const TODAY = '2026-09-26'

describe('attendancePlan', () => {
  test('week: Monday to Sunday around the day, a bucket per day, against the week before', () => {
    const plan = attendancePlan('week', TODAY, null)
    assert.equal(plan.from, '2026-09-21')
    assert.equal(plan.to, '2026-09-27')
    assert.deepEqual(plan.buckets, [
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ])
    assert.deepEqual(plan.previous, { from: '2026-09-14', to: '2026-09-20' })
  })

  test('week: a Monday opens its own week and a Sunday closes it', () => {
    const monday = attendancePlan('week', '2026-09-28', null)
    assert.deepEqual([monday.from, monday.to], ['2026-09-28', '2026-10-04'])
    assert.equal(attendancePlan('week', '2026-10-04', null).from, '2026-09-28')
  })

  test('week: a week across the year end keeps its seven days', () => {
    const plan = attendancePlan('week', '2026-01-01', null)
    assert.deepEqual([plan.from, plan.to], ['2025-12-29', '2026-01-04'])
    assert.equal(plan.buckets.length, 7)
    assert.deepEqual(plan.previous, { from: '2025-12-22', to: '2025-12-28' })
  })

  test('anchored: the month, year and quarter an earlier day falls in, each against the one before it', () => {
    const august = attendancePlan('month', '2026-08-17', null)
    assert.deepEqual([august.from, august.to, august.buckets.length], ['2026-08-01', '2026-08-31', 31])
    assert.deepEqual(august.previous, { from: '2026-07-01', to: '2026-07-31' })

    const lastYear = attendancePlan('year', '2025-03-04', null)
    assert.deepEqual([lastYear.from, lastYear.to], ['2025-01-01', '2025-12-31'])
    assert.deepEqual(lastYear.previous, { from: '2024-01-01', to: '2024-12-31' })

    const quarter = attendancePlan('quarter', '2026-05-20', null)
    assert.deepEqual([quarter.from, quarter.to], ['2026-03-01', '2026-05-31'])
  })

  test('month: the calendar month, a bucket per day, against last month', () => {
    const plan = attendancePlan('month', TODAY, null)
    assert.equal(plan.from, '2026-09-01')
    assert.equal(plan.to, '2026-09-30')
    assert.equal(plan.buckets.length, 30)
    assert.equal(plan.buckets[0], '2026-09-01')
    assert.equal(plan.buckets[1], '2026-09-02')
    assert.equal(plan.buckets[29], '2026-09-30')
    assert.deepEqual(plan.previous, { from: '2026-08-01', to: '2026-08-31' })
  })

  test('month: a 31-day month has 31 days and a leap February 29', () => {
    assert.equal(attendancePlan('month', '2026-10-18', null).buckets.length, 31)
    const february = attendancePlan('month', '2028-02-10', null)
    assert.equal(february.to, '2028-02-29')
    assert.equal(february.buckets.length, 29)
    assert.equal(february.buckets.at(-1), '2028-02-29')
  })

  test('month: January compares with December', () => {
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

describe('anchorRefusal', () => {
  const first = '2025-03-04'

  test('any day up to the end of the current period is answered', () => {
    assert.equal(anchorRefusal('week', TODAY, TODAY, first), null)
    // Sunday 27 September closes the week today is in.
    assert.equal(anchorRefusal('week', '2026-09-27', TODAY, first), null)
    assert.equal(anchorRefusal('month', '2026-09-30', TODAY, first), null)
    assert.equal(anchorRefusal('year', '2026-12-31', TODAY, first), null)
  })

  test('a day in a later period is refused', () => {
    assert.equal(anchorRefusal('week', '2026-09-28', TODAY, first), 'period_in_future')
    assert.equal(anchorRefusal('month', '2026-10-01', TODAY, first), 'period_in_future')
    assert.equal(anchorRefusal('year', '2027-01-01', TODAY, first), 'period_in_future')
  })

  test('a day before the year of the first attended session is refused; that year itself is not', () => {
    assert.equal(anchorRefusal('month', '2025-01-01', TODAY, first), null)
    assert.equal(anchorRefusal('month', '2024-12-31', TODAY, first), 'period_before_first_year')
    assert.equal(anchorRefusal('year', '2024-06-01', TODAY, first), 'period_before_first_year')
  })

  test('a member who has attended nothing can look back through this year alone', () => {
    assert.equal(anchorRefusal('month', '2026-01-10', TODAY, null), null)
    assert.equal(anchorRefusal('month', '2025-12-10', TODAY, null), 'period_before_first_year')
  })
})

describe('periodSteps', () => {
  const first = '2025-03-04'

  test('the current period has an earlier one and no later one', () => {
    assert.deepEqual(periodSteps(attendancePlan('month', TODAY, first), TODAY, first), { hasPrevious: true, hasNext: false })
    assert.deepEqual(periodSteps(attendancePlan('week', TODAY, first), TODAY, first), { hasPrevious: true, hasNext: false })
  })

  test('a past period has a later one', () => {
    assert.deepEqual(periodSteps(attendancePlan('month', '2026-08-01', first), TODAY, first), {
      hasPrevious: true,
      hasNext: true,
    })
  })

  test('the first year stops the steps back, whatever the period', () => {
    assert.deepEqual(periodSteps(attendancePlan('year', '2025-03-04', first), TODAY, first), {
      hasPrevious: false,
      hasNext: true,
    })
    assert.equal(periodSteps(attendancePlan('month', '2025-01-20', first), TODAY, first).hasPrevious, false)
    assert.equal(periodSteps(attendancePlan('month', '2025-02-20', first), TODAY, first).hasPrevious, true)
    // The week of 1 January 2025 opens on 30 December 2024; the one before lies wholly in 2024.
    assert.equal(periodSteps(attendancePlan('week', '2025-01-01', first), TODAY, first).hasPrevious, false)
    assert.equal(periodSteps(attendancePlan('week', '2025-01-06', first), TODAY, first).hasPrevious, true)
  })

  test('a member who has attended nothing has only this year to step through', () => {
    assert.deepEqual(periodSteps(attendancePlan('year', TODAY, null), TODAY, null), { hasPrevious: false, hasNext: false })
    assert.equal(periodSteps(attendancePlan('month', TODAY, null), TODAY, null).hasPrevious, true)
  })

  test('all time has nothing before or after it', () => {
    assert.deepEqual(periodSteps(attendancePlan('all', TODAY, first), TODAY, first), { hasPrevious: false, hasNext: false })
  })
})

describe('bucketCounts', () => {
  const month = attendancePlan('month', TODAY, null)

  test('week: each day is its own bucket, Monday to Sunday', () => {
    const counts = bucketCounts(attendancePlan('week', TODAY, null), [
      { day: '2026-09-20', attended: 4 }, // the Sunday before
      { day: '2026-09-21', attended: 1 },
      { day: '2026-09-27', attended: 1, booked: 1 },
      { day: '2026-09-28', attended: 4 }, // the Monday after
    ])
    assert.deepEqual(
      counts.map(c => [c.startsOn, c.attended, c.booked]),
      [
        ['2026-09-21', 1, 0],
        ['2026-09-22', 0, 0],
        ['2026-09-23', 0, 0],
        ['2026-09-24', 0, 0],
        ['2026-09-25', 0, 0],
        ['2026-09-26', 0, 0],
        ['2026-09-27', 1, 1],
      ],
    )
  })

  test('month: each day is its own bucket, attended and booked side by side', () => {
    const counts = bucketCounts(month, [
      { day: '2026-09-01', attended: 1 },
      { day: '2026-09-06', attended: 2 },
      { day: '2026-09-28', attended: 0, booked: 1 },
      { day: '2026-09-30', attended: 3, booked: 2 },
    ])
    assert.equal(counts.length, 30)
    assert.deepEqual(counts[0], { startsOn: '2026-09-01', attended: 1, booked: 0 })
    assert.deepEqual(counts[1], { startsOn: '2026-09-02', attended: 0, booked: 0 })
    assert.deepEqual(counts[5], { startsOn: '2026-09-06', attended: 2, booked: 0 })
    assert.deepEqual(counts[27], { startsOn: '2026-09-28', attended: 0, booked: 1 })
    assert.deepEqual(counts[29], { startsOn: '2026-09-30', attended: 3, booked: 2 })
  })

  test('quarter: each day lands in the week it falls in; a Sunday closes its week and a Monday opens the next', () => {
    const quarter = attendancePlan('quarter', TODAY, null)
    const counts = bucketCounts(quarter, [
      { day: '2026-07-01', attended: 1 },
      { day: '2026-07-05', attended: 2 }, // Sunday: still the first week
      { day: '2026-07-06', attended: 1, booked: 1 }, // Monday: the second
    ])
    assert.deepEqual(counts.slice(0, 3), [
      { startsOn: '2026-07-01', attended: 3, booked: 0 },
      { startsOn: '2026-07-06', attended: 1, booked: 1 },
      { startsOn: '2026-07-13', attended: 0, booked: 0 },
    ])
  })

  test('days outside the period are left out, in whatever order they come', () => {
    const counts = bucketCounts(month, [
      { day: '2026-10-01', attended: 5, booked: 1 },
      { day: '2026-09-15', attended: 1 },
      { day: '2026-08-31', attended: 4 },
    ])
    assert.deepEqual(
      counts,
      month.buckets.map(startsOn => ({ startsOn, attended: startsOn === '2026-09-15' ? 1 : 0, booked: 0 })),
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

describe('streakWeeks', () => {
  // TODAY is Saturday 26 September; its week began on Monday 21 September.
  test('counts the Monday weeks in a row up to this one', () => {
    assert.equal(streakWeeks(TODAY, ['2026-09-07', '2026-09-15', '2026-09-26']), 3)
  })

  test('a week with nothing in it yet does not break the run: it ends last week', () => {
    assert.equal(streakWeeks(TODAY, ['2026-09-01', '2026-09-08', '2026-09-20']), 3)
  })

  test('an empty week breaks it, and nothing this week or last leaves none', () => {
    assert.equal(streakWeeks(TODAY, ['2026-08-31', '2026-09-22']), 1)
    assert.equal(streakWeeks(TODAY, ['2026-09-07']), 0)
    assert.equal(streakWeeks(TODAY, []), 0)
  })

  test('two sessions in one week count that week once', () => {
    assert.equal(streakWeeks(TODAY, ['2026-09-21', '2026-09-22', '2026-09-26']), 1)
  })

  test('a run crosses the year end', () => {
    // Tuesday 6 January 2026: its week began Monday 5 January, the one before on 29 December.
    assert.equal(streakWeeks('2026-01-06', ['2025-12-24', '2025-12-31', '2026-01-05']), 3)
  })
})

describe('longestRunWeeks', () => {
  const year2025 = { from: '2025-01-01', to: '2025-12-31' }

  test('the longest run of Monday weeks with a session inside the period', () => {
    // The weeks of 3, 10 and 17 March (a run of three), then of 7 and 14 April (two).
    assert.equal(longestRunWeeks(year2025, ['2025-03-03', '2025-03-12', '2025-03-19', '2025-04-07', '2025-04-15']), 3)
    assert.equal(longestRunWeeks(year2025, []), 0)
  })

  test('two sessions in one week count that week once', () => {
    assert.equal(longestRunWeeks(year2025, ['2025-03-03', '2025-03-04', '2025-03-09']), 1)
  })

  test('sessions outside the period are left out, though a week split by its edge still counts', () => {
    // The week of 29 December 2025 runs into 2026; only its 2025 days are 2025's.
    assert.equal(longestRunWeeks(year2025, ['2025-12-22', '2025-12-30', '2026-01-05', '2026-01-12']), 2)
    assert.equal(longestRunWeeks(year2025, ['2024-12-30', '2025-01-06']), 1)
  })

  test('a run crosses the year end inside a period that does', () => {
    const quarter = { from: '2025-11-01', to: '2026-01-31' }
    assert.equal(longestRunWeeks(quarter, ['2025-12-22', '2025-12-31', '2026-01-05']), 3)
  })
})

describe('usualSlot', () => {
  const at = (day: string, hour: number) => ({ day, hour })

  test('the most common weekday and start hour, Monday being 1', () => {
    // 1, 8 and 15 September are Tuesdays; 3 September is a Thursday.
    assert.deepEqual(
      usualSlot([at('2026-09-01', 7), at('2026-09-08', 7), at('2026-09-03', 19), at('2026-09-15', 7)]),
      { weekday: 2, hour: 7 },
    )
  })

  test('nothing under three sessions', () => {
    assert.equal(usualSlot([at('2026-09-01', 7), at('2026-09-08', 7)]), null)
    assert.equal(usualSlot([]), null)
  })

  test('a tie goes to the earliest weekday, then the earliest hour', () => {
    // Thursday 19:00, Tuesday 18:00 and Tuesday 07:00, once each: Tuesday 7am.
    assert.deepEqual(usualSlot([at('2026-09-03', 19), at('2026-09-01', 18), at('2026-09-08', 7)]), {
      weekday: 2,
      hour: 7,
    })
    // Friday 07:00 twice against Monday 20:00 twice: Monday.
    assert.deepEqual(usualSlot([at('2026-09-04', 7), at('2026-09-11', 7), at('2026-09-07', 20), at('2026-09-14', 20)]), {
      weekday: 1,
      hour: 20,
    })
  })
})
