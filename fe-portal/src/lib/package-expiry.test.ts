import test from "node:test";
import assert from "node:assert";
import { expiryDay, expiryInstant } from "./package-expiry";

// Every instant here is built with the local-time Date constructor, so these
// hold in any timezone the runner happens to be in, as local-day.test.ts does.

test("PKG-50 the expiry Edit expiry sends is the last instant of the day picked on the studio's local clock, and a stored expiry reopens on its local day", () => {
  // 2 Nov picked: the package ends at the last moment of 2 Nov local time, so
  // the profile's "Valid until" reads 2 Nov (23:59:59 UTC is 3 Nov in Singapore).
  const sent = expiryInstant("2026-11-02");
  assert.ok(sent);
  assert.strictEqual(new Date(sent).getTime(), new Date(2026, 10, 2, 23, 59, 59, 999).getTime());
  assert.strictEqual(expiryDay(sent), "2026-11-02");

  // Late evening and early morning stay on their own day, whatever the zone.
  assert.strictEqual(expiryDay(new Date(2026, 10, 2, 23, 45).toISOString()), "2026-11-02");
  assert.strictEqual(expiryDay(new Date(2026, 10, 3, 0, 15).toISOString()), "2026-11-03");

  // Reopening and saving without a change keeps the end where it is.
  for (const day of ["2026-01-01", "2026-03-29", "2026-10-25", "2026-12-31"]) {
    assert.strictEqual(expiryInstant(expiryDay(expiryInstant(day))), expiryInstant(day), day);
  }

  // A blank day returns the package to Dormant; a package with no end opens blank.
  assert.strictEqual(expiryInstant(""), null);
  assert.strictEqual(expiryDay(null), "");

  // The dialog's latest pick (31 Dec 9999) ends in year 10000 UTC west of UTC,
  // which serialises as "+010000-01-01T..." and the API refuses. It is clamped
  // to the last instant of 9999 in any zone; run here under a zone west of UTC.
  const zone = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const latest = expiryInstant("9999-12-31");
    assert.ok(latest);
    assert.match(latest, /^9999-12-31T23:59:59\.999Z$/);
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});
