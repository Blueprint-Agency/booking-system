import test from "node:test";
import assert from "node:assert/strict";
import { presetRange, rangeToParams, sameRange } from "./date-range";

const SYDNEY = "Australia/Sydney";
const SINGAPORE = "Asia/Singapore";
const UTC = "UTC";

// The runner's own zone is irrelevant: every instant is written in UTC and the
// studio's zone is passed in.

// 00:30 on Wednesday 12 August 2026 in Sydney; still Tuesday 11 August in Singapore and UTC.
const SYDNEY_JUST_AFTER_MIDNIGHT = Date.parse("2026-08-11T14:30:00.000Z");

test("TEN-126 the period presets are the studio's calendar, so at 00:30 in Sydney it is already the next day there", () => {
  const at = SYDNEY_JUST_AFTER_MIDNIGHT;
  assert.deepEqual(presetRange(SYDNEY, "today", at), { from: "2026-08-12", to: "2026-08-12" });
  assert.deepEqual(presetRange(SINGAPORE, "today", at), { from: "2026-08-11", to: "2026-08-11" });
  assert.deepEqual(presetRange(UTC, "today", at), { from: "2026-08-11", to: "2026-08-11" });
  // This week runs from the Monday: Sydney is on Wednesday 12th, Singapore on Tuesday 11th, both in the week of the 10th.
  assert.deepEqual(presetRange(SYDNEY, "week", at), { from: "2026-08-10", to: "2026-08-12" });
  assert.deepEqual(presetRange(SINGAPORE, "week", at), { from: "2026-08-10", to: "2026-08-11" });
  assert.deepEqual(presetRange(SYDNEY, "7d", at), { from: "2026-08-06", to: "2026-08-12" });
  assert.deepEqual(presetRange(SINGAPORE, "14d", at), { from: "2026-07-29", to: "2026-08-11" });
  assert.deepEqual(presetRange(SYDNEY, "30d", at), { from: "2026-07-14", to: "2026-08-12" });
  assert.deepEqual(presetRange(SYDNEY, "all", at), null);
});

test("TEN-126 a month, last month and a year start on the studio's days when the studio's date has crossed a month or a year and the browser's has not", () => {
  // 00:30 on 1 September in Sydney is still 31 August in Singapore.
  const newMonth = Date.parse("2026-08-31T14:30:00.000Z");
  assert.deepEqual(presetRange(SYDNEY, "month", newMonth), { from: "2026-09-01", to: "2026-09-01" });
  assert.deepEqual(presetRange(SINGAPORE, "month", newMonth), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(presetRange(SYDNEY, "lastmonth", newMonth), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(presetRange(SINGAPORE, "lastmonth", newMonth), { from: "2026-07-01", to: "2026-07-31" });
  // 00:30 on New Year's Day in Sydney (UTC+11) is 21:30 on the 31st in Singapore.
  const newYear = Date.parse("2026-12-31T13:30:00.000Z");
  assert.deepEqual(presetRange(SYDNEY, "year", newYear), { from: "2027-01-01", to: "2027-01-01" });
  assert.deepEqual(presetRange(SINGAPORE, "year", newYear), { from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(presetRange(SYDNEY, "lastmonth", newYear), { from: "2026-12-01", to: "2026-12-31" });
  // The first of a month in January looks back to December of the year before.
  assert.deepEqual(presetRange(UTC, "lastmonth", Date.parse("2027-01-10T00:00:00.000Z")), {
    from: "2026-12-01",
    to: "2026-12-31",
  });
});

test("TEN-127 a period's days become the studio's midnights, so Sydney's day is not Singapore's and a daylight-saving day is 23 hours", () => {
  const range = { from: "2026-08-12", to: "2026-08-12" };
  assert.deepEqual(rangeToParams(SYDNEY, range), {
    from: "2026-08-11T14:00:00.000Z",
    to: "2026-08-12T13:59:59.999Z",
  });
  assert.deepEqual(rangeToParams(SINGAPORE, range), {
    from: "2026-08-11T16:00:00.000Z",
    to: "2026-08-12T15:59:59.999Z",
  });
  // 4 October 2026 is Sydney's 23-hour spring-forward day.
  const spring = rangeToParams(SYDNEY, { from: "2026-10-04", to: "2026-10-04" });
  assert.equal(spring.from, "2026-10-03T14:00:00.000Z");
  assert.equal(spring.to, "2026-10-04T12:59:59.999Z");
  assert.equal((Date.parse(spring.to!) + 1 - Date.parse(spring.from!)) / 3_600_000, 23);
  // A period of several days spans from the first midnight to the last day's end.
  assert.deepEqual(rangeToParams(SYDNEY, { from: "2026-10-03", to: "2026-10-05" }), {
    from: "2026-10-02T14:00:00.000Z",
    to: "2026-10-05T12:59:59.999Z",
  });
  // A day whose last hour happens twice (Santiago's clocks fall back at midnight) runs to the end of the second.
  assert.equal(
    rangeToParams("America/Santiago", { from: "2026-04-04", to: "2026-04-04" }).to,
    "2026-04-05T03:59:59.999Z",
  );
  // All time sends no period.
  assert.deepEqual(rangeToParams(SYDNEY, null), { from: undefined, to: undefined });
});

test("TEN-126 two periods are the same only when both hold the same days", () => {
  assert.equal(sameRange(null, null), true);
  assert.equal(sameRange(null, { from: "2026-08-12", to: "2026-08-12" }), false);
  assert.equal(
    sameRange({ from: "2026-08-12", to: "2026-08-12" }, { from: "2026-08-12", to: "2026-08-12" }),
    true,
  );
  assert.equal(
    sameRange({ from: "2026-08-12", to: "2026-08-12" }, { from: "2026-08-11", to: "2026-08-12" }),
    false,
  );
});
