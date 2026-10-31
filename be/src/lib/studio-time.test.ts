import assert from 'node:assert'
import { test } from 'node:test'
import {
  addDays,
  dayWindow,
  daysBetween,
  instantAt,
  isoWeekday,
  localDate,
  plusCalendarDays,
  zoneFormat,
} from './studio-time'

const SYDNEY = 'Australia/Sydney'
const SINGAPORE = 'Asia/Singapore'
const HOUR = 3_600_000

// Sydney's daylight saving in 2026 starts on Sunday 4 October (02:00 AEST becomes
// 03:00 AEDT) and ends on Sunday 5 April (03:00 AEDT becomes 02:00 AEST).

test('TEN-54 a studio\'s calendar day is read on its own zone, not Singapore\'s, UTC\'s or the server\'s', () => {
  // 00:30 on 12 August in Sydney (UTC+10): the 11th in Singapore and in UTC
  const winter = new Date('2026-08-11T14:30:00.000Z')
  assert.strictEqual(localDate(SYDNEY, winter), '2026-08-12')
  assert.strictEqual(localDate(SINGAPORE, winter), '2026-08-11')
  assert.strictEqual(localDate('UTC', winter), '2026-08-11')
  // 00:30 on 11 December in Sydney (UTC+11, daylight saving): 21:30 on the 10th in Singapore
  const summer = new Date('2026-12-10T13:30:00.000Z')
  assert.strictEqual(localDate(SYDNEY, summer), '2026-12-11')
  assert.strictEqual(localDate(SINGAPORE, summer), '2026-12-10')
  // the last minute of a Sydney day is still that day
  assert.strictEqual(localDate(SYDNEY, new Date('2026-08-12T13:59:59.000Z')), '2026-08-12')
  assert.strictEqual(localDate(SYDNEY, new Date('2026-08-12T14:00:00.000Z')), '2026-08-13')
})

test('TEN-55 a wall-clock time on a date is the studio\'s own, through the zone\'s rules on that date', () => {
  assert.strictEqual(instantAt(SYDNEY, '2026-08-12', '13:00').toISOString(), '2026-08-12T03:00:00.000Z')
  assert.strictEqual(instantAt(SYDNEY, '2026-12-12', '13:00').toISOString(), '2026-12-12T02:00:00.000Z')
  assert.strictEqual(instantAt(SINGAPORE, '2026-08-12', '13:00').toISOString(), '2026-08-12T05:00:00.000Z')
  // a half-hour zone
  assert.strictEqual(instantAt('Asia/Kolkata', '2026-08-12', '09:00').toISOString(), '2026-08-12T03:30:00.000Z')
  // west of UTC, where the studio's date is behind UTC's
  assert.strictEqual(instantAt('America/Los_Angeles', '2026-08-12', '19:00').toISOString(), '2026-08-13T02:00:00.000Z')
})

test('TEN-56 a wall time in the spring-forward gap resolves one hour later, and one that occurs twice at fall-back resolves to its first occurrence', () => {
  // 02:30 on 4 October does not exist in Sydney: 03:30 AEDT is 16:30 UTC on the 3rd
  assert.strictEqual(instantAt(SYDNEY, '2026-10-04', '02:30').toISOString(), '2026-10-03T16:30:00.000Z')
  assert.strictEqual(instantAt(SYDNEY, '2026-10-04', '03:30').toISOString(), '2026-10-03T16:30:00.000Z')
  assert.strictEqual(instantAt(SYDNEY, '2026-10-04', '01:30').toISOString(), '2026-10-03T15:30:00.000Z')
  // 02:30 on 5 April happens twice; the first is still AEDT (UTC+11)
  assert.strictEqual(instantAt(SYDNEY, '2026-04-05', '02:30').toISOString(), '2026-04-04T15:30:00.000Z')
  assert.strictEqual(instantAt(SYDNEY, '2026-04-05', '03:30').toISOString(), '2026-04-04T17:30:00.000Z')
  assert.strictEqual(instantAt(SYDNEY, '2026-04-05', '01:30').toISOString(), '2026-04-04T14:30:00.000Z')
})

test('TEN-57 a day is the half-open window from local midnight to the next local midnight, 23 or 25 hours on a transition day', () => {
  const day = (date: string) => {
    const w = dayWindow(SYDNEY, date)
    return { w, hours: (w.endsAt.getTime() - w.startsAt.getTime()) / HOUR }
  }
  assert.strictEqual(day('2026-08-12').hours, 24)
  const spring = day('2026-10-04')
  assert.strictEqual(spring.hours, 23)
  assert.strictEqual(spring.w.startsAt.toISOString(), '2026-10-03T14:00:00.000Z')
  assert.strictEqual(spring.w.endsAt.toISOString(), '2026-10-04T13:00:00.000Z')
  const autumn = day('2026-04-05')
  assert.strictEqual(autumn.hours, 25)
  assert.strictEqual(autumn.w.startsAt.toISOString(), '2026-04-04T13:00:00.000Z')
  assert.strictEqual(autumn.w.endsAt.toISOString(), '2026-04-05T14:00:00.000Z')
  // consecutive days meet exactly: no instant falls between two days or onto both
  assert.strictEqual(dayWindow(SYDNEY, '2026-10-03').endsAt.getTime(), spring.w.startsAt.getTime())
  assert.strictEqual(spring.w.endsAt.getTime(), dayWindow(SYDNEY, '2026-10-05').startsAt.getTime())
  // a run of days runs from the first day's start to the day after the last
  const run = dayWindow(SYDNEY, '2026-10-03', '2026-10-05')
  assert.strictEqual(run.startsAt.getTime(), dayWindow(SYDNEY, '2026-10-03').startsAt.getTime())
  assert.strictEqual(run.endsAt.getTime(), dayWindow(SYDNEY, '2026-10-05').endsAt.getTime())
  // Singapore has no transition: every day is 24 hours, a fixed eight hours off UTC
  assert.strictEqual(dayWindow(SINGAPORE, '2026-10-04').startsAt.toISOString(), '2026-10-03T16:00:00.000Z')
  assert.strictEqual(dayWindow(SINGAPORE, '2026-10-04').endsAt.toISOString(), '2026-10-04T16:00:00.000Z')
})

test('TEN-58 "N days ahead" counts calendar days, not multiples of 24 hours, and "a week later" keeps its wall time across a daylight-saving change', () => {
  // 3 October to 6 October is three calendar days although only 71 hours apart in Sydney
  assert.strictEqual(daysBetween('2026-10-03', '2026-10-06'), 3)
  const from = instantAt(SYDNEY, '2026-10-03', '09:00')
  const to = plusCalendarDays(SYDNEY, from, 3)
  assert.strictEqual(to.toISOString(), instantAt(SYDNEY, '2026-10-06', '09:00').toISOString())
  assert.strictEqual((to.getTime() - from.getTime()) / HOUR, 71)
  // seconds ride along
  const odd = new Date(from.getTime() + 17_000)
  assert.strictEqual(plusCalendarDays(SYDNEY, odd, 3).getTime(), to.getTime() + 17_000)
  // plain-date arithmetic needs no zone
  assert.strictEqual(addDays('2026-12-31', 1), '2027-01-01')
  assert.strictEqual(isoWeekday('2026-10-04'), 7)
})

test('TEN-59 a formatter is fixed to the studio\'s zone, and cached per zone, locale and layout', () => {
  const at = new Date('2026-08-11T14:30:00.000Z')
  const layout = { day: 'numeric', month: 'short', year: 'numeric' } as const
  assert.strictEqual(zoneFormat(SYDNEY, 'en-GB', layout).format(at), '12 Aug 2026')
  assert.strictEqual(zoneFormat(SINGAPORE, 'en-GB', layout).format(at), '11 Aug 2026')
  assert.strictEqual(zoneFormat(SYDNEY, 'en-GB', layout), zoneFormat(SYDNEY, 'en-GB', layout))
  assert.notStrictEqual(zoneFormat(SYDNEY, 'en-GB', layout), zoneFormat(SINGAPORE, 'en-GB', layout))
  // a zone the runtime does not know is an error, never a quiet fallback
  assert.throws(() => localDate('Not/AZone', at), RangeError)
  assert.throws(() => zoneFormat('Not/AZone', 'en-GB', layout), RangeError)
})
