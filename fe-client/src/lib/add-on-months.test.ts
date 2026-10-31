import { test } from "node:test";
import assert from "node:assert/strict";
import { roundsUpAPartMonth } from "./add-on-months.ts";
import { plusCalendarDays, plusCalendarMonths } from "./studio-time.ts";

const SG = "Asia/Singapore";
const SYDNEY = "Australia/Sydney";

test("the part-months sentence only fires when a part month was rounded up", () => {
  const now = Date.parse("2026-08-17T09:14:33.412Z");
  const iso = (ms: number) => new Date(ms).toISOString();

  // A plan bought seconds ago: the server quotes its full Duration, so the
  // charged months land exactly on the plan's end and nothing is rounded up.
  assert.equal(roundsUpAPartMonth(iso(plusCalendarMonths(SG, now, 6)), 6, SG, now), false);
  // ...and still false when the two instants disagree by less than a day, so an
  // exact-equality comparison would fail here.
  assert.equal(roundsUpAPartMonth(iso(plusCalendarMonths(SG, now, 6) - 5000), 6, SG, now), false);

  // A part-used plan: 3 months and 10 days of cover left is charged as 4 whole
  // months, so the member is owed the sentence.
  assert.equal(roundsUpAPartMonth(iso(plusCalendarDays(SG, plusCalendarMonths(SG, now, 3), 10)), 4, SG, now), true);
  // One whole day over is the boundary, and it counts.
  assert.equal(roundsUpAPartMonth(iso(plusCalendarDays(SG, plusCalendarMonths(SG, now, 4), -1)), 4, SG, now), true);

  // A Dormant plan quotes 0 months against nothing to count back from — no
  // arithmetic to explain, so no sentence.
  assert.equal(roundsUpAPartMonth(iso(now), 0, SG, now), false);
});

test("TEN-100 the months and days are counted on the studio's calendar, so a Sydney plan is judged by Sydney's days across daylight saving", () => {
  // 10:00 on 20 September in Sydney (UTC+10); six months on is 10:00 on 20 March, after the clocks change twice (UTC+11).
  const now = Date.parse("2026-09-20T00:00:00.000Z");
  const sixMonths = plusCalendarMonths(SYDNEY, now, 6);
  assert.equal(new Date(sixMonths).toISOString(), "2027-03-19T23:00:00.000Z");
  assert.equal(roundsUpAPartMonth(new Date(sixMonths).toISOString(), 6, SYDNEY, now), false);
});

test("TEN-101 a plan ending the same wall time a calendar day before the charged months' end is a whole day short, though only 23 hours apart across the Sydney daylight-saving start", () => {
  // 10:00 on 4 September in Sydney; a month on is 10:00 on 4 October, after the clocks went forward at 02:00 that day.
  const now = Date.parse("2026-09-04T00:00:00.000Z");
  assert.equal(new Date(plusCalendarMonths(SYDNEY, now, 1)).toISOString(), "2026-10-03T23:00:00.000Z");
  // 10:00 on 3 October (UTC+10) is 23 hours before that, and one calendar day.
  assert.equal(roundsUpAPartMonth("2026-10-03T00:00:00.000Z", 1, SYDNEY, now), true);
  // 10:30 on 3 October is not yet a whole day short.
  assert.equal(roundsUpAPartMonth("2026-10-03T00:30:00.000Z", 1, SYDNEY, now), false);
});
