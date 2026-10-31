import test from "node:test";
import assert from "node:assert/strict";
import { studioZoneChoices } from "./studio-time-zones";

test("TEN-104 the New studio zone picker starts on the administrator's own browser zone, whichever it is, never Singapore", () => {
  for (const browser of ["Australia/Sydney", "America/New_York", "Europe/London", "Asia/Kolkata", "Pacific/Auckland"]) {
    assert.equal(studioZoneChoices(browser).initial, browser);
  }
  // Even from a browser that could not name its zone, the form does not start on Singapore.
  assert.notEqual(studioZoneChoices("").initial, "Asia/Singapore");
});

test("TEN-104 the picker lists the runtime's real IANA zones, each once and in order, and includes the browser's own", () => {
  const { zones } = studioZoneChoices("Australia/Sydney");
  assert.deepEqual(zones, [...new Set(zones)], "no zone twice");
  assert.deepEqual(zones, [...zones].sort(), "in order");
  for (const real of ["Asia/Singapore", "Australia/Sydney", "America/Los_Angeles", "Europe/Paris", "Pacific/Auckland"]) {
    assert.ok(zones.includes(real), `${real} is listed`);
  }
  assert.ok(zones.length > 300, `a real list, not a hand-kept few (${zones.length})`);
  assert.ok(zones.every(zone => /^[A-Za-z_]+(\/[A-Za-z_+\-0-9]+)*$/.test(zone)), "only zone names, no offsets");
});

test("TEN-104 a browser zone the runtime's list leaves out (UTC) is still offered, so the picker can start on it", () => {
  const supported = ["Asia/Singapore", "Australia/Sydney"];
  const { initial, zones } = studioZoneChoices("UTC", supported);
  assert.equal(initial, "UTC");
  assert.deepEqual(zones, ["Asia/Singapore", "Australia/Sydney", "UTC"]);
  assert.deepEqual(studioZoneChoices("Asia/Singapore", supported).zones, supported, "a zone already listed is not added again");
});
