import test from "node:test";
import assert from "node:assert";
import { expiryDay, expiryInstant } from "./package-expiry";

// Every instant here is written in UTC and the studio's zone is passed in, so
// these hold in any timezone the runner happens to be in, as local-day.test.ts does.
const SINGAPORE = "Asia/Singapore";
const SYDNEY = "Australia/Sydney";

test("PKG-50 the expiry Edit expiry sends is the last instant of the day picked on the studio's clock, and a stored expiry reopens on its studio day", () => {
  // 2 Nov picked: the package ends at the last moment of 2 Nov studio time, so
  // the profile's "Valid until" reads 2 Nov (23:59:59 UTC is 3 Nov in Singapore).
  const sent = expiryInstant(SINGAPORE, "2026-11-02");
  assert.ok(sent);
  assert.strictEqual(sent, "2026-11-02T15:59:59.999Z");
  assert.strictEqual(expiryDay(SINGAPORE, sent), "2026-11-02");

  // Late evening and early morning stay on their own day, whatever the zone.
  assert.strictEqual(expiryDay(SINGAPORE, "2026-11-02T15:45:00.000Z"), "2026-11-02");
  assert.strictEqual(expiryDay(SINGAPORE, "2026-11-02T16:15:00.000Z"), "2026-11-03");

  // Reopening and saving without a change keeps the end where it is.
  for (const day of ["2026-01-01", "2026-03-29", "2026-10-25", "2026-12-31"]) {
    assert.strictEqual(
      expiryInstant(SINGAPORE, expiryDay(SINGAPORE, expiryInstant(SINGAPORE, day))),
      expiryInstant(SINGAPORE, day),
      day,
    );
  }

  // A blank day returns the package to Dormant; a package with no end opens blank.
  assert.strictEqual(expiryInstant(SINGAPORE, ""), null);
  assert.strictEqual(expiryDay(SINGAPORE, null), "");

  // The dialog's latest pick (31 Dec 9999) ends in year 10000 UTC west of UTC,
  // which serialises as "+010000-01-01T..." and the API refuses. It is clamped
  // to the last instant of 9999 in any zone, west of UTC included.
  for (const zone of ["America/New_York", SINGAPORE, SYDNEY]) {
    const latest = expiryInstant(zone, "9999-12-31");
    assert.ok(latest, zone);
    assert.match(latest, /^9999-12-31T\d\d:\d\d:\d\d\.999Z$/, zone);
  }
  assert.strictEqual(expiryInstant("America/New_York", "9999-12-31"), "9999-12-31T23:59:59.999Z");
});

test("TEN-128 a package picked to expire on a day ends at that day's last instant at the studio, which is a different moment in Sydney than in Singapore", () => {
  // 2 Nov 2026 in Sydney (UTC+11 under daylight saving): the day ends at 12:59:59 UTC.
  const sydney = expiryInstant(SYDNEY, "2026-11-02");
  assert.strictEqual(sydney, "2026-11-02T12:59:59.999Z");
  assert.strictEqual(expiryInstant(SINGAPORE, "2026-11-02"), "2026-11-02T15:59:59.999Z");
  assert.strictEqual(expiryDay(SYDNEY, sydney), "2026-11-02");
  // The stored end 23:59:59 UTC on 2 Nov is already 3 Nov in Sydney, and in Singapore.
  assert.strictEqual(expiryDay(SYDNEY, "2026-11-02T23:59:59.000Z"), "2026-11-03");
  // The last instant of a day on a 23-hour daylight-saving day is an hour sooner than 24 hours on.
  assert.strictEqual(expiryInstant(SYDNEY, "2026-10-04"), "2026-10-04T12:59:59.999Z");
  assert.strictEqual(expiryInstant(SYDNEY, "2026-10-03"), "2026-10-03T13:59:59.999Z");
  // Where the clocks fall back at midnight the day's last hour happens twice, and the package runs to the end of the second.
  assert.strictEqual(expiryInstant("America/Santiago", "2026-04-04"), "2026-04-05T03:59:59.999Z");
  // Reopening a Sydney package and saving without a change keeps its end.
  assert.strictEqual(expiryInstant(SYDNEY, expiryDay(SYDNEY, sydney)), sydney);
});
