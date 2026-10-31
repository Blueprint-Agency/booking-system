import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canCreateStudio } from "./create-tenant-form";
import {
  CURRENT_ZONE_NAME,
  currentZoneName,
  studioZoneChoices,
  zoneRefusalMessage,
} from "./studio-time-zones";
import { StudioZoneField } from "@/components/platform/studio-zone-field";

const SHORT_LIST = ["Asia/Singapore", "Australia/Sydney"];

test("TEN-106 the New studio zone picker starts on the administrator's own browser zone, whichever it is", () => {
  for (const browser of ["Australia/Sydney", "America/New_York", "Europe/London", "Asia/Tokyo", "Pacific/Auckland"]) {
    assert.equal(studioZoneChoices(browser).initial, browser);
  }
  // From a zone it has nothing to say about, it starts on that zone's own name,
  // not on a platform default.
  assert.equal(studioZoneChoices("Pacific/Kiritimati").initial, "Pacific/Kiritimati");
  assert.equal(studioZoneChoices("America/Sao_Paulo", SHORT_LIST).initial, "America/Sao_Paulo");
});

test("TEN-106 a browser that names no zone starts the picker on nothing, so no studio is put on a zone nobody chose", () => {
  assert.equal(studioZoneChoices("").initial, "");
  assert.equal(studioZoneChoices("", SHORT_LIST).initial, "");
});

test("TEN-106 the picker lists the runtime's real IANA zones, each once and in order, and includes the browser's own", () => {
  const { zones, freeText } = studioZoneChoices("Australia/Sydney");
  assert.equal(freeText, false);
  assert.deepEqual(zones, [...new Set(zones)], "no zone twice");
  assert.deepEqual(zones, [...zones].sort(), "in order");
  for (const real of ["Asia/Singapore", "Australia/Sydney", "America/Los_Angeles", "Europe/Paris", "Pacific/Auckland", "UTC"]) {
    assert.ok(zones.includes(real), `${real} is listed`);
  }
  assert.ok(zones.length > 300, `a real list, not a hand-kept few (${zones.length})`);
  assert.ok(zones.every(zone => /^[A-Za-z_]+(\/[A-Za-z_+\-0-9]+)*$/.test(zone)), "only zone names, no offsets");
});

test("TEN-106 a browser zone the runtime's list leaves out (UTC) is still offered, once, so the picker can start on it", () => {
  const { initial, zones } = studioZoneChoices("UTC", SHORT_LIST);
  assert.equal(initial, "UTC");
  assert.deepEqual(zones, ["Asia/Singapore", "Australia/Sydney", "UTC"]);
  assert.deepEqual(studioZoneChoices("Asia/Singapore", SHORT_LIST).zones, [...SHORT_LIST, "UTC"], "a zone already listed is not added again");
});

test("TEN-106 a legacy link spelling is shown and pre-filled under the zone's current name, so what is posted is what Debian's Postgres reads", () => {
  // The runtime's own list carries the old spellings, and omits the current ones.
  const runtime = Intl.supportedValuesOf("timeZone");
  assert.ok(runtime.includes("Asia/Calcutta"), "this runtime still lists Asia/Calcutta");
  const { zones } = studioZoneChoices("Asia/Calcutta");
  assert.ok(zones.includes("Asia/Kolkata"), "Asia/Kolkata is offered");
  for (const old of Object.keys(CURRENT_ZONE_NAME)) assert.ok(!zones.includes(old), `${old} is not offered`);
  for (const current of Object.values(CURRENT_ZONE_NAME)) assert.ok(zones.includes(current), `${current} is offered`);

  // Chrome in India reports Asia/Calcutta; the picker starts on Asia/Kolkata.
  assert.equal(studioZoneChoices("Asia/Calcutta").initial, "Asia/Kolkata");
  assert.equal(studioZoneChoices("Europe/Kiev", SHORT_LIST).initial, "Europe/Kyiv");
  assert.equal(currentZoneName("Asia/Calcutta"), "Asia/Kolkata");
  assert.equal(currentZoneName("Australia/Sydney"), "Australia/Sydney");
});

test("TEN-106 a runtime with no zone list gets a typed field instead of a picker, still starting on the browser's zone", () => {
  assert.deepEqual(studioZoneChoices("Australia/Sydney", null), { initial: "Australia/Sydney", zones: [], freeText: true });
  assert.deepEqual(studioZoneChoices("", []), { initial: "", zones: [], freeText: true });
});

test("TEN-106 the zone field is a select over the list, or a text field when there is no list, and the help text is tied to it", () => {
  const picker = renderToStaticMarkup(
    createElement(StudioZoneField, { zone: "Australia/Sydney", onChange: () => {}, choices: studioZoneChoices("Australia/Sydney", SHORT_LIST) }),
  );
  assert.match(picker, /<select[^>]+id="tenant-timezone"[^>]+aria-describedby="tenant-timezone-help"/);
  assert.match(picker, /<option value="Australia\/Sydney" selected/);
  assert.match(picker, /<p id="tenant-timezone-help"/);
  assert.doesNotMatch(picker, /Choose a time zone/, "a pre-filled zone needs no placeholder option");

  const noZone = renderToStaticMarkup(
    createElement(StudioZoneField, { zone: "", onChange: () => {}, choices: studioZoneChoices("", SHORT_LIST) }),
  );
  assert.match(noZone, /<option value="" selected[^>]*>Choose a time zone/);

  const typed = renderToStaticMarkup(
    createElement(StudioZoneField, { zone: "", onChange: () => {}, choices: studioZoneChoices("", null) }),
  );
  assert.doesNotMatch(typed, /<select/);
  assert.match(typed, /<input[^>]+id="tenant-timezone"[^>]+aria-describedby="tenant-timezone-help"/);
});

test("TEN-106 Create stays disabled until a zone is chosen, whatever else is filled in", () => {
  const ready = { submitting: false, name: "Acme Yoga", slug: "acme", slugAvailable: true, prefixError: undefined, timezone: "Australia/Sydney" };
  assert.equal(canCreateStudio(ready), true);
  assert.equal(canCreateStudio({ ...ready, timezone: "" }), false, "no zone");
  assert.equal(canCreateStudio({ ...ready, name: " " }), false);
  assert.equal(canCreateStudio({ ...ready, slugAvailable: false }), false);
  assert.equal(canCreateStudio({ ...ready, submitting: true }), false);
  assert.equal(canCreateStudio({ ...ready, prefixError: "too long" }), false);
});

test("TEN-106 a refused zone is answered in words that fit how it was entered, and never tells the operator to pick what they picked", () => {
  assert.match(zoneRefusalMessage("timezone_required", "", false)!, /choose.*time zone/i);
  assert.match(zoneRefusalMessage("timezone_required", "", true)!, /enter.*time zone/i);

  const typed = zoneRefusalMessage("timezone_invalid", "Mars/Base", true)!;
  assert.match(typed, /Mars\/Base/);
  assert.match(typed, /spelling/i);

  const picked = zoneRefusalMessage("timezone_invalid", "Asia/Kolkata", false)!;
  assert.match(picked, /Asia\/Kolkata/);
  assert.doesNotMatch(picked, /choose .*from the list|pick .*from the list/i);

  assert.equal(zoneRefusalMessage("slug_taken", "Asia/Kolkata", false), null, "other codes are not this one's to answer");
});
