import { test } from "node:test";
import assert from "node:assert/strict";
import { dayHeaderLabel, feedDays, feedWindow } from "./schedule-days.ts";

const SYDNEY = "Australia/Sydney";
const SINGAPORE = "Asia/Singapore";
const HOUR = 3_600_000;

// Sydney's daylight saving in 2026 starts on Sunday 4 October (02:00 AEST becomes
// 03:00 AEDT, a 23-hour day) and ends on Sunday 5 April (03:00 AEDT becomes
// 02:00 AEST, a 25-hour day).

test("TEN-111 the schedule opens at the studio's midnight and runs ten days on, not at the device's or Singapore's", () => {
  // 00:30 on Wednesday 12 August in Sydney (UTC+10): 22:30 on the 11th in Singapore, 14:30 in UTC.
  const now = Date.parse("2026-08-11T14:30:00.000Z");
  assert.deepEqual(feedWindow(SYDNEY, now, 10), {
    from: "2026-08-11T14:00:00.000Z",
    to: "2026-08-21T14:00:00.000Z",
  });
  // The same instant is still the 11th for a Singapore studio.
  assert.deepEqual(feedWindow(SINGAPORE, now, 10), {
    from: "2026-08-10T16:00:00.000Z",
    to: "2026-08-20T16:00:00.000Z",
  });
  // A minute before Sydney's midnight is still the 12th.
  assert.equal(feedWindow(SYDNEY, Date.parse("2026-08-12T13:59:00.000Z"), 10).from, "2026-08-11T14:00:00.000Z");
  assert.equal(feedWindow(SYDNEY, Date.parse("2026-08-12T14:00:00.000Z"), 10).from, "2026-08-12T14:00:00.000Z");
});

test("TEN-112 the window follows the studio's midnights across both daylight-saving days", () => {
  // 04:00 on 4 October, the day the clocks go forward: today began at 00:00 AEST (UTC+10) and ten
  // days on is 00:00 on the 14th, in AEDT (UTC+11).
  const spring = feedWindow(SYDNEY, Date.parse("2026-10-03T17:00:00.000Z"), 10);
  assert.deepEqual(spring, { from: "2026-10-03T14:00:00.000Z", to: "2026-10-13T13:00:00.000Z" });
  // The window's first day is 23 hours long.
  assert.equal((Date.parse(feedWindow(SYDNEY, Date.parse("2026-10-03T17:00:00.000Z"), 1).to) - Date.parse(spring.from)) / HOUR, 23);
  // 06:00 on 5 April, the day the clocks go back: today began at 00:00 AEDT (UTC+11) and ten days
  // on is 00:00 on the 15th, in AEST (UTC+10); the first day is 25 hours long.
  const autumn = feedWindow(SYDNEY, Date.parse("2026-04-04T20:00:00.000Z"), 10);
  assert.deepEqual(autumn, { from: "2026-04-04T13:00:00.000Z", to: "2026-04-14T14:00:00.000Z" });
  assert.equal((Date.parse(feedWindow(SYDNEY, Date.parse("2026-04-04T20:00:00.000Z"), 1).to) - Date.parse(autumn.from)) / HOUR, 25);
});

test("TEN-113 a day's header says Today and Tomorrow on the studio's calendar, and the weekday of the date it names", () => {
  // 00:30 on Wednesday 12 August in Sydney, still the 11th in Singapore.
  const now = Date.parse("2026-08-11T14:30:00.000Z");
  assert.equal(dayHeaderLabel("2026-08-12", SYDNEY, now), "Today · Aug 12");
  assert.equal(dayHeaderLabel("2026-08-13", SYDNEY, now), "Tomorrow · Aug 13");
  assert.equal(dayHeaderLabel("2026-08-14", SYDNEY, now), "Fri · Aug 14");
  assert.equal(dayHeaderLabel("2026-08-12", SINGAPORE, now), "Tomorrow · Aug 12");
  assert.equal(dayHeaderLabel("2026-08-11", SINGAPORE, now), "Today · Aug 11");
  // Tomorrow is the next calendar date even when today is the 23-hour day.
  const springMorning = Date.parse("2026-10-03T17:00:00.000Z");
  assert.equal(dayHeaderLabel("2026-10-04", SYDNEY, springMorning), "Today · Oct 4");
  assert.equal(dayHeaderLabel("2026-10-05", SYDNEY, springMorning), "Tomorrow · Oct 5");
  assert.equal(dayHeaderLabel("2026-10-06", SYDNEY, springMorning), "Tue · Oct 6");
});

const at = (isoTime: string) => ({ id: isoTime, starts_at: isoTime });
const shape = (days: ReturnType<typeof feedDays<{ id: string; starts_at: string }>>) =>
  days.map((d) => [d.date, d.items.map((i) => i.id)]);

test("TEN-114 classes group under the studio's day: 23:30 and 00:30 either side of Sydney's midnight are two days, and one in Singapore", () => {
  const now = Date.parse("2026-08-11T14:30:00.000Z");
  const classes = [
    at("2026-08-12T14:30:00.000Z"), // 00:30 on the 13th in Sydney, 22:30 on the 12th in Singapore
    at("2026-08-12T13:30:00.000Z"), // 23:30 on the 12th in Sydney, 21:30 on the 12th in Singapore
    at("2026-08-11T14:00:00.000Z"), // already started: left out
  ];
  assert.deepEqual(shape(feedDays(classes, now, SYDNEY)), [
    ["2026-08-12", ["2026-08-12T13:30:00.000Z"]],
    ["2026-08-13", ["2026-08-12T14:30:00.000Z"]],
  ]);
  assert.deepEqual(shape(feedDays(classes, now, SINGAPORE)), [
    ["2026-08-12", ["2026-08-12T13:30:00.000Z", "2026-08-12T14:30:00.000Z"]],
  ]);
});

test("TEN-114 on the daylight-saving days a studio's day still ends at its own midnight", () => {
  const before = Date.parse("2026-10-01T00:00:00.000Z");
  // The 23-hour day, 4 October: 14:00 UTC on the 3rd to 13:00 UTC on the 4th.
  const spring = feedDays(
    [at("2026-10-03T13:59:00.000Z"), at("2026-10-03T14:00:00.000Z"), at("2026-10-04T12:59:00.000Z"), at("2026-10-04T13:00:00.000Z")],
    before,
    SYDNEY,
  );
  assert.deepEqual(shape(spring), [
    ["2026-10-03", ["2026-10-03T13:59:00.000Z"]],
    ["2026-10-04", ["2026-10-03T14:00:00.000Z", "2026-10-04T12:59:00.000Z"]],
    ["2026-10-05", ["2026-10-04T13:00:00.000Z"]],
  ]);
  // The 25-hour day, 5 April: 13:00 UTC on the 4th to 14:00 UTC on the 5th.
  const autumn = feedDays(
    [at("2026-04-04T12:59:00.000Z"), at("2026-04-04T13:00:00.000Z"), at("2026-04-05T13:59:00.000Z"), at("2026-04-05T14:00:00.000Z")],
    Date.parse("2026-04-01T00:00:00.000Z"),
    SYDNEY,
  );
  assert.deepEqual(shape(autumn), [
    ["2026-04-04", ["2026-04-04T12:59:00.000Z"]],
    ["2026-04-05", ["2026-04-04T13:00:00.000Z", "2026-04-05T13:59:00.000Z"]],
    ["2026-04-06", ["2026-04-05T14:00:00.000Z"]],
  ]);
});
