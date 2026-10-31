import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonthsUtc, roundsUpAPartMonth } from "./add-on-months.ts";

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

// The server's own rule, restated independently for the expected values
// (be/src/services/packages/validity.ts): calendar months in UTC, the day of
// the month clamped to the target month's last, on the UTC clock whatever the
// studio's zone. The app mirrors it; it does not read the studio's clock here.
function serverAddMonths(from: number, months: number): number {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}

test("the part-months sentence only fires when a part month was rounded up", () => {
  const now = Date.parse("2026-08-17T09:14:33.412Z");

  // A plan bought seconds ago: the server quotes its full Duration, so the
  // charged months land exactly on the plan's end and nothing is rounded up.
  assert.equal(roundsUpAPartMonth(iso(serverAddMonths(now, 6)), 6, now), false);
  // ...and still false when the two instants disagree by less than a day, so an
  // exact-equality comparison would fail here.
  assert.equal(roundsUpAPartMonth(iso(serverAddMonths(now, 6) - 5000), 6, now), false);

  // A part-used plan: 3 months and 10 days of cover left is charged as 4 whole
  // months, so the member is owed the sentence.
  assert.equal(roundsUpAPartMonth(iso(serverAddMonths(now, 3) + 10 * 24 * HOUR), 4, now), true);
  // One whole day over is the boundary, and it counts.
  assert.equal(roundsUpAPartMonth(iso(serverAddMonths(now, 4) - 24 * HOUR), 4, now), true);

  // A Dormant plan quotes 0 months against nothing to count back from — no
  // arithmetic to explain, so no sentence.
  assert.equal(roundsUpAPartMonth(iso(now), 0, now), false);
});

test("the months are the server's: UTC calendar months, clamped to the month's end", () => {
  assert.equal(iso(addMonthsUtc(Date.parse("2026-08-31T10:00:00.000Z"), 6)), "2027-02-28T10:00:00.000Z");
  assert.equal(iso(addMonthsUtc(Date.parse("2026-01-31T23:30:00.000Z"), 1)), "2026-02-28T23:30:00.000Z");
  assert.equal(iso(addMonthsUtc(Date.parse("2026-11-15T00:00:00.000Z"), 3)), "2027-02-15T00:00:00.000Z");
  for (const [from, months] of [["2026-08-31T10:00:00.000Z", 6], ["2028-02-29T00:00:00.000Z", 12], ["2026-05-31T12:00:00.000Z", 9]] as const) {
    assert.equal(addMonthsUtc(Date.parse(from), months), serverAddMonths(Date.parse(from), months));
  }
});

test("TEN-100 a Sydney studio's plan is judged by the server's UTC months, not Sydney's calendar, across both daylight-saving changes", () => {
  // 10:00 on 20 September in Sydney; the server's six months on is 20 March 00:00 UTC.
  const now = Date.parse("2026-09-20T00:00:00.000Z");
  const planEnd = serverAddMonths(now, 6);
  assert.equal(iso(planEnd), "2027-03-20T00:00:00.000Z");
  assert.equal(roundsUpAPartMonth(iso(planEnd), 6, now), false);
  // A day short of the charged months is a part month, whatever the studio's clock says.
  assert.equal(roundsUpAPartMonth(iso(planEnd - 24 * HOUR), 6, now), true);
});

test("TEN-101 a day is 24 hours, as the server counts it: a plan ending 23 hours before the charged months' end is not a day short, 24 hours before is", () => {
  const now = Date.parse("2026-09-04T00:00:00.000Z");
  const charged = serverAddMonths(now, 1);
  assert.equal(roundsUpAPartMonth(iso(charged - 23 * HOUR), 1, now), false);
  assert.equal(roundsUpAPartMonth(iso(charged - 24 * HOUR), 1, now), true);
  assert.equal(roundsUpAPartMonth(iso(charged - 24 * HOUR - 1), 1, now), true);
});

test("TEN-110 a plan activated at 01:00 on 1 March 2027 in Sydney and checked five minutes later is whole months, so there is no part-month sentence", () => {
  // 01:00 on 1 March 2027 in Sydney (UTC+11) is 14:00 UTC on 28 February. The server's one month
  // (UTC) ends on 28 March at 14:00 UTC; counted on Sydney's calendar the same month would end on
  // 1 April, three days on, and the sentence would fire for a plan bought five minutes ago.
  const activated = Date.parse("2027-02-28T14:00:00.000Z");
  const expiresAt = serverAddMonths(activated, 1);
  assert.equal(iso(expiresAt), "2027-03-28T14:00:00.000Z");
  const checked = activated + 5 * 60_000;
  assert.equal(roundsUpAPartMonth(iso(expiresAt), 1, checked), false);
});
