import test from "node:test";
import assert from "node:assert/strict";
import {
  gridDays,
  gridWindow,
  minutesFromMidnight,
  startsOnDay,
  upcomingWindow,
} from "./schedule-grid";

const SYDNEY = "Australia/Sydney";
const SINGAPORE = "Asia/Singapore";
const HOUR = 3_600_000;

// The runner's own zone is irrelevant: every instant is written in UTC and the
// studio's zone is passed in.

test("TEN-129 a day, a week and a month view span the studio's calendar days, the week from Monday and the month in six week rows", () => {
  // 2026-08-12 is a Wednesday; its week runs Monday 10 to Sunday 16 August.
  assert.deepEqual(gridDays("day", "2026-08-12"), { first: "2026-08-12", last: "2026-08-12" });
  assert.deepEqual(gridDays("week", "2026-08-12"), { first: "2026-08-10", last: "2026-08-16" });
  assert.deepEqual(gridDays("week", "2026-08-16"), { first: "2026-08-10", last: "2026-08-16" });
  // August 2026 begins on a Saturday, so the grid opens on Monday 27 July and fills six weeks.
  assert.deepEqual(gridDays("month", "2026-08-12"), { first: "2026-07-27", last: "2026-09-06" });
});

test("TEN-129 the instants a view asks for open at the studio's midnight, so Sydney's day starts hours before Singapore's and a daylight-saving week is an hour short", () => {
  const day = gridWindow(SYDNEY, "day", "2026-08-12");
  assert.deepEqual(day, { from: "2026-08-11T14:00:00.000Z", to: "2026-08-12T14:00:00.000Z" });
  assert.deepEqual(gridWindow(SINGAPORE, "day", "2026-08-12"), {
    from: "2026-08-11T16:00:00.000Z",
    to: "2026-08-12T16:00:00.000Z",
  });
  // The week of Monday 28 September to Sunday 4 October holds Sydney's 23-hour day.
  const week = gridWindow(SYDNEY, "week", "2026-10-01");
  assert.equal(week.from, "2026-09-27T14:00:00.000Z");
  assert.equal(week.to, "2026-10-04T13:00:00.000Z");
  assert.equal((Date.parse(week.to) - Date.parse(week.from)) / HOUR, 7 * 24 - 1);
  // The day view of the transition day itself is 23 hours.
  const spring = gridWindow(SYDNEY, "day", "2026-10-04");
  assert.equal((Date.parse(spring.to) - Date.parse(spring.from)) / HOUR, 23);
  // ...and of the autumn one 25.
  const autumn = gridWindow(SYDNEY, "day", "2026-04-05");
  assert.equal((Date.parse(autumn.to) - Date.parse(autumn.from)) / HOUR, 25);
});

test("TEN-130 an event sits under the studio's day and at the studio's hour, so a 00:30 class in Sydney is not drawn at the foot of the day before", () => {
  // 00:30 on Wednesday 12 August in Sydney is 22:30 on the 11th in Singapore.
  const startsAt = "2026-08-11T14:30:00.000Z";
  assert.equal(startsOnDay(SYDNEY, startsAt, "2026-08-12"), true);
  assert.equal(startsOnDay(SYDNEY, startsAt, "2026-08-11"), false);
  assert.equal(startsOnDay(SINGAPORE, startsAt, "2026-08-11"), true);
  assert.equal(minutesFromMidnight(SYDNEY, startsAt), 30);
  assert.equal(minutesFromMidnight(SINGAPORE, startsAt), 22 * 60 + 30);
  // The last minute of a Sydney day is that day, the next minute the next.
  assert.equal(startsOnDay(SYDNEY, "2026-08-12T13:59:00.000Z", "2026-08-12"), true);
  assert.equal(startsOnDay(SYDNEY, "2026-08-12T14:00:00.000Z", "2026-08-13"), true);
  // A class at 19:00 after the clocks go forward still reads 19:00, though it is an hour earlier in UTC.
  assert.equal(minutesFromMidnight(SYDNEY, "2026-10-03T08:00:00.000Z"), 18 * 60);
  assert.equal(minutesFromMidnight(SYDNEY, "2026-10-04T08:00:00.000Z"), 19 * 60);
  assert.equal(startsOnDay(SYDNEY, "2026-10-04T08:00:00.000Z", "2026-10-04"), true);
});

test("TEN-131 the instructor's 60-day list runs from the studio's midnight today to its midnight 60 calendar days on", () => {
  // 00:30 on 12 August in Sydney: the list starts on the 12th there, not the 11th.
  const at = Date.parse("2026-08-11T14:30:00.000Z");
  const sydney = upcomingWindow(SYDNEY, 60, at);
  assert.equal(sydney.from, "2026-08-11T14:00:00.000Z");
  assert.equal(sydney.to, "2026-10-10T13:00:00.000Z");
  const singapore = upcomingWindow(SINGAPORE, 60, at);
  assert.equal(singapore.from, "2026-08-10T16:00:00.000Z");
  assert.equal(singapore.to, "2026-10-09T16:00:00.000Z");
  // Sixty calendar days from 12 August in Sydney is 11 October, whose midnight is
  // an hour earlier in UTC than 60 x 24 hours on, because the clocks went forward on 4 October.
  assert.equal((Date.parse(sydney.to) - Date.parse(sydney.from)) / HOUR, 60 * 24 - 1);
});
