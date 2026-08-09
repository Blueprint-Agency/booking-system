import assert from "node:assert";
import { atLocalTime, localDay, localDayRange } from "./local-day";

// Every instant here is built with the local-time Date constructor, so these
// hold in any timezone the runner happens to be in — not just SGT.

// Late local evening stays on its own day. Slicing the UTC ISO string pushes
// this to the 10th anywhere east of UTC.
assert.strictEqual(localDay(new Date(2026, 7, 9, 23, 45)), "2026-08-09");

// Early local morning likewise — a UTC slice pulls this back to the 9th.
assert.strictEqual(localDay(new Date(2026, 7, 10, 0, 15)), "2026-08-10");

// The clock is a parameter, so "today" is checkable rather than whatever the
// machine says.
assert.strictEqual(localDay(new Date(2027, 0, 1, 0, 0)), "2027-01-01");

// API timestamps arrive as ISO strings.
assert.strictEqual(localDay(new Date(2026, 7, 9, 23, 45).toISOString()), "2026-08-09");

// Round trip, both directions.
assert.strictEqual(localDay(atLocalTime("2026-08-09", "23:45")), "2026-08-09");
const noon = new Date(2026, 7, 9, 12, 0);
assert.strictEqual(atLocalTime(localDay(noon), "12:00").getTime(), noon.getTime());

// A full day covers both its endpoints and nothing on the neighbouring days.
const { start, end } = localDayRange("2026-08-09");
assert.strictEqual(localDay(start), "2026-08-09");
assert.strictEqual(localDay(end), "2026-08-09");
assert.strictEqual(start.getHours(), 0);
assert.strictEqual(start.getMinutes(), 0);
assert.ok(start <= new Date(2026, 7, 9, 0, 0));
assert.ok(new Date(2026, 7, 9, 23, 59, 59) <= end);
assert.ok(new Date(2026, 7, 8, 23, 59, 59, 999) < start);
assert.ok(new Date(2026, 7, 10, 0, 0) > end);

console.log("local-day.test ok");
