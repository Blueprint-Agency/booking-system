import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  addMonths,
  datePlus,
  dayWindow,
  daysBetween,
  endOfMonth,
  formatInZone,
  formatPlain,
  instantAt,
  isKnownZone,
  isoWeekday,
  localClock,
  localDate,
  minutesIntoDay,
  requireStudioZone,
  startOfMonth,
  startOfWeek,
  zoneFormat,
} from "./studio-time";

const SYDNEY = "Australia/Sydney";
const SINGAPORE = "Asia/Singapore";
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

// Sydney's daylight saving in 2026 starts on Sunday 4 October (02:00 AEST becomes
// 03:00 AEDT) and ends on Sunday 5 April (03:00 AEDT becomes 02:00 AEST). The
// runner's own zone is irrelevant: nothing here may read it.

test("TEN-117 the staff portal reads a studio's calendar day and clock on its own zone, not Singapore's, UTC's or the browser's", () => {
  // 00:30 on 12 August in Sydney (UTC+10): still the 11th in Singapore and in UTC.
  const winter = Date.parse("2026-08-11T14:30:00.000Z");
  assert.equal(localDate(SYDNEY, winter), "2026-08-12");
  assert.equal(localDate(SINGAPORE, winter), "2026-08-11");
  assert.equal(localDate("UTC", winter), "2026-08-11");
  assert.equal(localClock(SYDNEY, winter), "00:30");
  assert.equal(localClock(SINGAPORE, winter), "22:30");
  assert.equal(minutesIntoDay(SYDNEY, winter), 30);
  assert.equal(minutesIntoDay(SINGAPORE, winter), 22 * 60 + 30);
  // 00:30 on 11 December in Sydney (UTC+11, daylight saving): 21:30 on the 10th in Singapore.
  const summer = "2026-12-10T13:30:00.000Z";
  assert.equal(localDate(SYDNEY, summer), "2026-12-11");
  assert.equal(localDate(SINGAPORE, summer), "2026-12-10");
  // The last minute of a Sydney day is still that day.
  assert.equal(localDate(SYDNEY, new Date("2026-08-12T13:59:59.000Z")), "2026-08-12");
  assert.equal(localDate(SYDNEY, new Date("2026-08-12T14:00:00.000Z")), "2026-08-13");
  // West of UTC, the studio's day is behind UTC's.
  assert.equal(localDate("America/Los_Angeles", "2026-08-12T05:00:00.000Z"), "2026-08-11");
  // "N days ahead" counts the studio's calendar days from its today.
  assert.equal(datePlus(SYDNEY, 3, winter), "2026-08-15");
  assert.equal(datePlus(SINGAPORE, 3, winter), "2026-08-14");
});

test("TEN-118 a time typed into the portal is the studio's wall time, and one in the spring-forward gap lands an hour later and a repeated one takes its first occurrence", () => {
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
  // Typed text that is no date or no time is no instant, rather than a throw.
  assert.ok(Number.isNaN(instantAt(SYDNEY, "", "09:00")));
  assert.ok(Number.isNaN(instantAt(SYDNEY, "2026-08-12", "")));
  assert.ok(Number.isNaN(instantAt(SYDNEY, "not-a-date", "09:00")));
});

test("TEN-119 a studio day is the half-open window from local midnight to the next local midnight, 23 or 25 hours on a transition day", () => {
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
  // Consecutive days meet exactly, so a class falls on one day and never two.
  assert.equal(dayWindow(SYDNEY, "2026-10-03").endsAt, dayWindow(SYDNEY, "2026-10-04").startsAt);
  assert.equal(dayWindow(SYDNEY, "2026-10-04").endsAt, dayWindow(SYDNEY, "2026-10-05").startsAt);
  // A run of days ends where the day after its last begins.
  const run = dayWindow(SYDNEY, "2026-10-03", "2026-10-05");
  assert.equal(run.startsAt, dayWindow(SYDNEY, "2026-10-03").startsAt);
  assert.equal(run.endsAt, dayWindow(SYDNEY, "2026-10-06").startsAt);
  // Sydney's day is not Singapore's: the same date opens ten hours earlier than UTC, two than Singapore.
  assert.equal(
    dayWindow(SINGAPORE, "2026-08-12").startsAt - dayWindow(SYDNEY, "2026-08-12").startsAt,
    2 * HOUR,
  );
});

test("TEN-120 the grids' calendar arithmetic on plain days needs no zone: Monday weeks, month edges and a month step that clamps", () => {
  assert.equal(addDays("2026-10-03", 2), "2026-10-05");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(daysBetween("2026-10-03", "2026-10-06"), 3);
  assert.equal(isoWeekday("2026-10-04"), 7);
  assert.equal(isoWeekday("2026-10-05"), 1);
  // Weeks start on Monday: Sunday 4 October belongs to the week of Monday 28 September.
  assert.equal(startOfWeek("2026-10-04"), "2026-09-28");
  assert.equal(startOfWeek("2026-10-05"), "2026-10-05");
  assert.equal(startOfMonth("2026-10-17"), "2026-10-01");
  assert.equal(endOfMonth("2026-10-17"), "2026-10-31");
  assert.equal(endOfMonth("2028-02-10"), "2028-02-29");
  assert.equal(addMonths("2026-10-31", 1), "2026-11-30");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-01-15", -1), "2025-12-15");
  assert.equal(addMonths("2026-10-17", 12), "2027-10-17");
});

test("TEN-121 an instant is laid out on the studio's clock in the portal's own date patterns, and a plain day reads as the day it names", () => {
  // 00:30 on Wednesday 12 August in Sydney, 22:30 on Tuesday the 11th in Singapore.
  const at = "2026-08-11T14:30:00.000Z";
  assert.equal(formatInZone(SYDNEY, at, "EEE d MMM"), "Wed 12 Aug");
  assert.equal(formatInZone(SINGAPORE, at, "EEE d MMM"), "Tue 11 Aug");
  assert.equal(formatInZone(SYDNEY, at, "EEEE, d MMM yyyy"), "Wednesday, 12 Aug 2026");
  assert.equal(formatInZone(SYDNEY, at, "h:mma"), "12:30AM");
  assert.equal(formatInZone(SINGAPORE, at, "h:mma"), "10:30PM");
  assert.equal(formatInZone(SYDNEY, at, "EEE d MMM, h:mma"), "Wed 12 Aug, 12:30AM");
  assert.equal(formatInZone(SYDNEY, at, "HH:mm"), "00:30");
  assert.equal(formatInZone(SYDNEY, at, "d MMM yyyy"), "12 Aug 2026");
  assert.equal(formatInZone(SYDNEY, at, "MMMM yyyy"), "August 2026");
  assert.equal(formatInZone(SYDNEY, at, "EEEEE"), "W");
  assert.equal(formatInZone(SYDNEY, at, "dd/MM"), "12/08");
  // Literals in quotes pass through; a token it does not know is an error, not a guess.
  assert.equal(formatInZone(SYDNEY, at, "d 'of' MMM"), "12 of Aug");
  assert.throws(() => formatInZone(SYDNEY, at, "QQQ"), /Unsupported date pattern/);
  // Noon and midnight on the 12-hour clock.
  assert.equal(formatInZone(SYDNEY, "2026-08-12T02:00:00.000Z", "h:mma"), "12:00PM");
  assert.equal(formatInZone(SYDNEY, "2026-08-11T14:00:00.000Z", "h:mma"), "12:00AM");
  // A plain day is the day it names, in any layout and from any runner.
  assert.equal(formatPlain("2026-10-01", "EEE d MMM"), "Thu 1 Oct");
  assert.equal(formatPlain("2026-01-01", "d MMM yyyy"), "1 Jan 2026");
  assert.equal(formatPlain("2026-12-31", "MMMM yyyy"), "December 2026");
});

test("TEN-122 outside a studio there is no clock, and a zone the browser does not know is told apart so the portal can say so", () => {
  assert.throws(() => requireStudioZone(null), /No studio is resolved/);
  assert.equal(requireStudioZone(SYDNEY), SYDNEY);
  assert.equal(isKnownZone(SYDNEY), true);
  assert.equal(isKnownZone("UTC"), true);
  assert.equal(isKnownZone("Mars/Base"), false);
  // An unknown zone is an error, never a quiet fallback to UTC or the runner's zone.
  assert.throws(() => localDate("Mars/Base", Date.now()), RangeError);
  assert.throws(() => zoneFormat("Mars/Base", "en-SG", { hour: "numeric" }), RangeError);
  // One formatter is built per zone, locale and layout.
  assert.equal(
    zoneFormat(SYDNEY, "en-SG", { hour: "numeric", minute: "2-digit" }),
    zoneFormat(SYDNEY, "en-SG", { hour: "numeric", minute: "2-digit" }),
  );
});
