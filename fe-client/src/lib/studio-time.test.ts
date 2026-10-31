import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  dayWindow,
  daysBetween,
  datePlus,
  formatClassTime,
  formatDate,
  formatExpiryDate,
  formatPlainDate,
  instantAt,
  isoWeekday,
  localClock,
  localDate,
  plusCalendarDays,
  plusCalendarMonths,
  wholeDaysBetween,
  zoneFormat,
} from "./studio-time.ts";

const SYDNEY = "Australia/Sydney";
const SINGAPORE = "Asia/Singapore";
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

// Sydney's daylight saving in 2026 starts on Sunday 4 October (02:00 AEST becomes
// 03:00 AEDT) and ends on Sunday 5 April (03:00 AEDT becomes 02:00 AEST). The
// runner's own zone is irrelevant: nothing here may read it.

test("TEN-82 a studio's calendar day and clock are read on its own zone, not Singapore's, UTC's or the device's", () => {
  // 00:30 on 12 August in Sydney (UTC+10): still the 11th in Singapore and in UTC.
  const winter = Date.parse("2026-08-11T14:30:00.000Z");
  assert.equal(localDate(SYDNEY, winter), "2026-08-12");
  assert.equal(localDate(SINGAPORE, winter), "2026-08-11");
  assert.equal(localDate("UTC", winter), "2026-08-11");
  assert.equal(localClock(SYDNEY, winter), "00:30");
  assert.equal(localClock(SINGAPORE, winter), "22:30");
  // 00:30 on 11 December in Sydney (UTC+11, daylight saving): 21:30 on the 10th in Singapore.
  const summer = "2026-12-10T13:30:00.000Z";
  assert.equal(localDate(SYDNEY, summer), "2026-12-11");
  assert.equal(localDate(SINGAPORE, summer), "2026-12-10");
  // The last minute of a Sydney day is still that day.
  assert.equal(localDate(SYDNEY, new Date("2026-08-12T13:59:59.000Z")), "2026-08-12");
  assert.equal(localDate(SYDNEY, new Date("2026-08-12T14:00:00.000Z")), "2026-08-13");
  // West of UTC, the studio's day is behind UTC's.
  assert.equal(localDate("America/Los_Angeles", "2026-08-12T05:00:00.000Z"), "2026-08-11");
});

test("TEN-83 a wall time on a date is the studio's own; one in the spring-forward gap lands an hour later and a repeated one takes its first occurrence", () => {
  assert.equal(iso(instantAt(SYDNEY, "2026-08-12", "13:00")), "2026-08-12T03:00:00.000Z");
  assert.equal(iso(instantAt(SYDNEY, "2026-12-12", "13:00")), "2026-12-12T02:00:00.000Z");
  assert.equal(iso(instantAt(SINGAPORE, "2026-08-12", "13:00")), "2026-08-12T05:00:00.000Z");
  assert.equal(iso(instantAt("Asia/Kolkata", "2026-08-12", "09:00")), "2026-08-12T03:30:00.000Z");
  assert.equal(iso(instantAt("America/Los_Angeles", "2026-08-12", "19:00")), "2026-08-13T02:00:00.000Z");
  // 02:30 on 4 October does not exist in Sydney: 03:30 AEDT is 16:30 UTC on the 3rd.
  assert.equal(iso(instantAt(SYDNEY, "2026-10-04", "02:30")), "2026-10-03T16:30:00.000Z");
  assert.equal(iso(instantAt(SYDNEY, "2026-10-04", "03:30")), "2026-10-03T16:30:00.000Z");
  assert.equal(iso(instantAt(SYDNEY, "2026-10-04", "01:30")), "2026-10-03T15:30:00.000Z");
  // 02:30 on 5 April happens twice; the first is still AEDT (UTC+11).
  assert.equal(iso(instantAt(SYDNEY, "2026-04-05", "02:30")), "2026-04-04T15:30:00.000Z");
  assert.equal(iso(instantAt(SYDNEY, "2026-04-05", "03:30")), "2026-04-04T17:30:00.000Z");
  assert.equal(iso(instantAt(SYDNEY, "2026-04-05", "01:30")), "2026-04-04T14:30:00.000Z");
});

test("TEN-84 a day is the half-open window from local midnight to the next local midnight, 23 or 25 hours on a transition day", () => {
  const day = (date: string) => {
    const w = dayWindow(SYDNEY, date);
    return { w, hours: (w.endsAt - w.startsAt) / HOUR };
  };
  assert.equal(day("2026-08-12").hours, 24);
  const spring = day("2026-10-04");
  assert.equal(spring.hours, 23);
  assert.equal(iso(spring.w.startsAt), "2026-10-03T14:00:00.000Z");
  assert.equal(iso(spring.w.endsAt), "2026-10-04T13:00:00.000Z");
  const autumn = day("2026-04-05");
  assert.equal(autumn.hours, 25);
  assert.equal(iso(autumn.w.startsAt), "2026-04-04T13:00:00.000Z");
  assert.equal(iso(autumn.w.endsAt), "2026-04-05T14:00:00.000Z");
  // Consecutive days meet exactly: no instant falls between two days or onto both.
  assert.equal(dayWindow(SYDNEY, "2026-10-03").endsAt, spring.w.startsAt);
  assert.equal(spring.w.endsAt, dayWindow(SYDNEY, "2026-10-05").startsAt);
  // A run of days runs from the first day's start to the day after the last.
  const run = dayWindow(SYDNEY, "2026-10-03", "2026-10-05");
  assert.equal(run.startsAt, dayWindow(SYDNEY, "2026-10-03").startsAt);
  assert.equal(run.endsAt, dayWindow(SYDNEY, "2026-10-05").endsAt);
  // Singapore has no transition: every day is 24 hours, a fixed eight hours off UTC.
  assert.equal(iso(dayWindow(SINGAPORE, "2026-10-04").startsAt), "2026-10-03T16:00:00.000Z");
  assert.equal(iso(dayWindow(SINGAPORE, "2026-10-04").endsAt), "2026-10-04T16:00:00.000Z");
});

test("TEN-85 N days ahead counts calendar days on the studio's clock, not multiples of 24 hours", () => {
  // 01:00 on Sunday 4 October in Sydney, the morning daylight saving starts; 23:00 on the 3rd in Singapore.
  const now = Date.parse("2026-10-03T15:00:00.000Z");
  assert.equal(datePlus(SYDNEY, 3, now), "2026-10-07");
  assert.equal(datePlus(SINGAPORE, 3, now), "2026-10-06");
  assert.equal(datePlus("UTC", 3, now), "2026-10-06");
  assert.equal(datePlus(SYDNEY, 0, now), "2026-10-04");
  // 3 October to 6 October is three calendar days although only 71 hours apart in Sydney.
  assert.equal(daysBetween("2026-10-03", "2026-10-06"), 3);
  const from = instantAt(SYDNEY, "2026-10-03", "09:00");
  const to = plusCalendarDays(SYDNEY, from, 3);
  assert.equal(to, instantAt(SYDNEY, "2026-10-06", "09:00"));
  assert.equal((to - from) / HOUR, 71);
  // Plain-date arithmetic needs no zone.
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(isoWeekday("2026-10-04"), 7);
});

test("TEN-86 months are calendar months on the studio's clock, clamped to the month's end, and whole days are counted on its calendar", () => {
  // 31 January 00:30 in Sydney (the 30th in UTC) plus one month is 28 February, same wall time.
  const jan = instantAt(SYDNEY, "2027-01-31", "00:30");
  assert.equal(iso(jan), "2027-01-30T13:30:00.000Z");
  assert.equal(plusCalendarMonths(SYDNEY, jan, 1), instantAt(SYDNEY, "2027-02-28", "00:30"));
  // Across the October change the wall time holds: 09:00 on 20 September plus a month is 09:00 on 20 October.
  const sep = instantAt(SYDNEY, "2026-09-20", "09:00");
  assert.equal(plusCalendarMonths(SYDNEY, sep, 1), instantAt(SYDNEY, "2026-10-20", "09:00"));
  assert.equal(plusCalendarMonths(SYDNEY, sep, 0), sep);
  // Whole days left: a day is whole only once the same wall time comes round.
  assert.equal(wholeDaysBetween(SYDNEY, instantAt(SYDNEY, "2026-10-03", "09:00"), instantAt(SYDNEY, "2026-10-06", "09:00")), 3);
  assert.equal(wholeDaysBetween(SYDNEY, instantAt(SYDNEY, "2026-10-03", "09:00"), instantAt(SYDNEY, "2026-10-06", "08:59")), 2);
  assert.equal(wholeDaysBetween(SYDNEY, instantAt(SYDNEY, "2026-10-03", "09:00"), instantAt(SYDNEY, "2026-10-03", "09:00")), 0);
});

test("TEN-87 every date and time a member reads is formatted on the studio's clock", () => {
  // 00:30 on Wednesday 1 July in Sydney, 22:30 on Tuesday 30 June in Singapore.
  const at = "2026-06-30T14:30:00.000Z";
  assert.equal(formatDate(at, SYDNEY), "Wed, 1 Jul");
  assert.equal(formatDate(at, SINGAPORE), "Tue, 30 Jun");
  assert.equal(formatExpiryDate(at, SYDNEY), "Wed, 1 Jul 2026");
  assert.equal(formatClassTime(at, SYDNEY), "12:30 am");
  assert.equal(formatClassTime(at, SINGAPORE), "10:30 pm");
  // A plain date has no clock to convert: it reads as the day it names, whatever the zone.
  assert.equal(formatPlainDate("2026-10-01"), "Thu, 1 Oct");
  assert.equal(formatPlainDate("2026-10-01T00:00:00.000Z"), "Thu, 1 Oct");
});

test("TEN-88 a formatter is fixed to the studio's zone and cached; a zone the runtime does not know is an error, not a quiet fallback", () => {
  const at = new Date("2026-08-11T14:30:00.000Z");
  const layout = { day: "numeric", month: "short", year: "numeric" } as const;
  assert.equal(zoneFormat(SYDNEY, "en-GB", layout).format(at), "12 Aug 2026");
  assert.equal(zoneFormat(SINGAPORE, "en-GB", layout).format(at), "11 Aug 2026");
  assert.equal(zoneFormat(SYDNEY, "en-GB", layout), zoneFormat(SYDNEY, "en-GB", layout));
  assert.throws(() => localDate("Not/AZone", at), RangeError);
  assert.throws(() => formatDate(at.toISOString(), "Not/AZone"), RangeError);
});
