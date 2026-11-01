import test from "node:test";
import assert from "node:assert/strict";
import { atLocalTime, localDay, localDayRange } from "./local-day";
import { addDays } from "./studio-time";

const SYDNEY = "Australia/Sydney";
const SINGAPORE = "Asia/Singapore";

// Every instant here is written in UTC and every zone is passed in, so these hold
// in any timezone the runner happens to be in.

test("TEN-123 a calendar day, the instants a day picked in a date field spans, and the wall time typed on it are all the studio's own", () => {
  // Late evening stays on its own day. Slicing the UTC ISO string pushes this
  // to the 10th anywhere east of UTC.
  assert.equal(localDay(SINGAPORE, "2026-08-09T15:45:00.000Z"), "2026-08-09");
  // Early morning likewise — a UTC slice pulls this back to the 9th.
  assert.equal(localDay(SINGAPORE, "2026-08-09T16:15:00.000Z"), "2026-08-10");
  assert.equal(localDay(SINGAPORE, "2026-12-31T16:00:00.000Z"), "2027-01-01");
  // The same instant is a different day in Sydney (UTC+10) and in Singapore (UTC+8).
  assert.equal(localDay(SYDNEY, "2026-08-11T14:30:00.000Z"), "2026-08-12");
  assert.equal(localDay(SINGAPORE, "2026-08-11T14:30:00.000Z"), "2026-08-11");
  // The clock is a parameter, so "today" is checkable rather than whatever the machine says.
  assert.equal(localDay(SYDNEY, Date.parse("2026-08-11T14:30:00.000Z")), "2026-08-12");
  assert.equal(localDay(SYDNEY, new Date("2026-08-11T14:30:00.000Z")), "2026-08-12");

  // A bare calendar day is already a day — it must not be re-parsed as UTC
  // midnight, which reads as the previous day west of UTC.
  assert.equal(localDay("America/Los_Angeles", "2026-08-09"), "2026-08-09");
  assert.equal(localDay(SYDNEY, localDay(SYDNEY, "2026-01-01")), "2026-01-01");

  // 19:00 typed on a day is 19:00 at the studio, not on the browser's clock.
  assert.equal(atLocalTime(SYDNEY, "2026-08-12", "19:00").toISOString(), "2026-08-12T09:00:00.000Z");
  assert.equal(atLocalTime(SINGAPORE, "2026-08-12", "19:00").toISOString(), "2026-08-12T11:00:00.000Z");
  // Round trip, both directions.
  const noon = atLocalTime(SYDNEY, "2026-08-12", "12:00");
  assert.equal(localDay(SYDNEY, noon), "2026-08-12");
  assert.equal(atLocalTime(SYDNEY, localDay(SYDNEY, noon), "12:00").getTime(), noon.getTime());

  // A full day covers both its endpoints and nothing on the neighbouring days.
  const { start, end } = localDayRange(SYDNEY, "2026-08-12");
  assert.equal(start.toISOString(), "2026-08-11T14:00:00.000Z");
  assert.equal(end.toISOString(), "2026-08-12T13:59:59.999Z");
  assert.equal(localDay(SYDNEY, start), "2026-08-12");
  assert.equal(localDay(SYDNEY, end), "2026-08-12");
  assert.equal(localDay(SYDNEY, start.getTime() - 1), "2026-08-11");
  assert.equal(localDay(SYDNEY, end.getTime() + 1), "2026-08-13");
});

test("TEN-123 a day's range ends one millisecond before the next midnight, including where the clocks fall back at midnight and the last hour happens twice", () => {
  // Santiago (4 April 2026), Cairo (29 October) and Beirut (24 October) put the
  // clocks back at midnight, so the day has 25 hours and its last hour is repeated.
  for (const [zone, day] of [
    ["America/Santiago", "2026-04-04"],
    ["Africa/Cairo", "2026-10-29"],
    ["Asia/Beirut", "2026-10-24"],
  ] as const) {
    const { start, end } = localDayRange(zone, day);
    const next = atLocalTime(zone, addDays(day, 1), "00:00");
    assert.equal(end.getTime() + 1, next.getTime(), `${zone} ends the instant before the next midnight`);
    assert.equal((next.getTime() - start.getTime()) / 3_600_000, 25, `${zone} ${day} has 25 hours`);
    assert.equal(localDay(zone, end), day, zone);
    assert.equal(localDay(zone, next), addDays(day, 1), zone);
  }
  assert.equal(localDayRange("America/Santiago", "2026-04-04").end.toISOString(), "2026-04-05T03:59:59.999Z");
  assert.equal(localDayRange("Africa/Cairo", "2026-10-29").end.toISOString(), "2026-10-29T21:59:59.999Z");
  assert.equal(localDayRange("Asia/Beirut", "2026-10-24").end.toISOString(), "2026-10-24T21:59:59.999Z");
});

test("TEN-123 a day's range on a Sydney daylight-saving day ends at that day's own last instant", () => {
  // 4 October 2026 has 23 hours: it opens at 14:00 UTC on the 3rd and the next
  // day opens at 13:00 UTC on the 4th.
  const spring = localDayRange(SYDNEY, "2026-10-04");
  assert.equal(spring.start.toISOString(), "2026-10-03T14:00:00.000Z");
  assert.equal(spring.end.toISOString(), "2026-10-04T12:59:59.999Z");
  assert.equal(localDayRange(SYDNEY, "2026-10-05").start.getTime(), spring.end.getTime() + 1);
  // 5 April 2026 has 25 hours.
  const autumn = localDayRange(SYDNEY, "2026-04-05");
  assert.equal(autumn.start.toISOString(), "2026-04-04T13:00:00.000Z");
  assert.equal(autumn.end.toISOString(), "2026-04-05T13:59:59.999Z");
  assert.equal(localDayRange(SYDNEY, "2026-04-06").start.getTime(), autumn.end.getTime() + 1);
});
