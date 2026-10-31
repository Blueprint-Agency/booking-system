import test from "node:test";
import assert from "node:assert";
import {
  archiveWarning,
  assertLoadedInFull,
  latestRead,
  locationSaveRefusal,
  locationsToManage,
  mayEditLocations,
  workspaceLocations,
} from "./location-list";
import type { Location } from "@/types";

const row = (id: string, name: string, over: Partial<Location> = {}): Location => ({
  id,
  name,
  address: "1 Orchard Road",
  gmapsUrl: "",
  phone: "",
  archivedAt: null,
  ...over,
});

// What the signed-in staff payload gives: names and addresses, never a phone or a Maps link.
const short = [row("a", "Orchard"), row("b", "Tampines")];
const full = [
  row("a", "Orchard", { phone: "+6561234567", gmapsUrl: "https://maps.app.goo.gl/abc" }),
  row("b", "Tampines", { phone: "+6567654321" }),
  row("c", "Old Studio", { archivedAt: "2026-01-01T00:00:00.000Z" }),
];

test("LOC-18 an admin is offered no edit, archive or restore while the studio's full locations are loading or failed to load, and no row to act on", () => {
  for (const status of ["loading", "failed"] as const) {
    assert.strictEqual(mayEditLocations(status), false, status);
    // The short list never stands in for the full one on a screen that edits.
    assert.deepStrictEqual(locationsToManage(status, null), [], status);
    assert.deepStrictEqual(locationsToManage(status, full), [], status);
  }
});

test("LOC-18 saving a location refuses a row that did not come from the loaded full list, so no blank phone or Maps link can be sent over the real ones", () => {
  // The short list's row for `a` has a blank phone; the full list's has the real one.
  assert.throws(() => assertLoadedInFull(null, "loaded", short[0]!), /full list/i);
  assert.throws(() => assertLoadedInFull(full, "loaded", row("zzz", "Not in the list")), /full list/i);
  assert.doesNotThrow(() => assertLoadedInFull(full, "loaded", full[0]!));
  // A full list that is not the loaded one (re-reading, failed) is no basis for a save, even holding the id.
  for (const status of ["idle", "loading", "failed"] as const) {
    assert.throws(() => assertLoadedInFull(full, status, full[0]!), /full list/i, status);
  }
});

test("LOC-18 the location form shows the guard's own sentence when a save is refused for want of the full list, and the fallback for any other failure", () => {
  const fallback = "The location could not be saved. Try again.";
  let guard: unknown;
  try {
    assertLoadedInFull(null, "failed", short[0]!);
  } catch (err) {
    guard = err;
  }
  const shown = locationSaveRefusal(guard, fallback);
  assert.match(shown, /full list/i);
  assert.notStrictEqual(shown, fallback);
  assert.strictEqual(locationSaveRefusal(new Error("network"), fallback), fallback);
});

test("LOC-18 only the latest read of the full list may land: a read a newer one has replaced, or a reset has cancelled, is ignored whether it succeeded or failed", () => {
  const reads = latestRead();
  const first = reads.begin();
  assert.strictEqual(reads.isCurrent(first), true);
  const second = reads.begin();
  assert.strictEqual(reads.isCurrent(first), false);
  assert.strictEqual(reads.isCurrent(second), true);
  reads.cancel();
  assert.strictEqual(reads.isCurrent(second), false);
  assert.strictEqual(reads.isCurrent(reads.begin()), true);
});

test("LOC-19 once the full list has loaded, an Admin may edit and the screens that edit list every location, archived ones included", () => {
  assert.strictEqual(mayEditLocations("loaded"), true);
  assert.deepStrictEqual(locationsToManage("loaded", full), full);
});

test("LOC-19 the workspace switcher keeps listing the studio's locations from the short list when the full list is missing, and from the full list once it is there", () => {
  assert.deepStrictEqual(workspaceLocations(short, null), short);
  assert.deepStrictEqual(workspaceLocations(short, full), full);
});

test("ADM-07 archiving a location asks nothing when no live Unlimited Plan calls it home, and names the stranded members when some do", () => {
  assert.strictEqual(archiveWarning(0, "Orchard"), null);
  assert.strictEqual(
    archiveWarning(1, "Orchard"),
    "1 live Unlimited Plan calls Orchard home. Archiving it strands that member. Archive anyway?",
  );
  assert.strictEqual(
    archiveWarning(3, "Orchard"),
    "3 live Unlimited Plans call Orchard home. Archiving it strands those members. Archive anyway?",
  );
});

test("ADM-07 archiving a location whose Unlimited Plan count could not be read says it could not check, and never proceeds as if the count were 0", () => {
  const warning = archiveWarning(null, "Orchard");
  assert.ok(warning !== null);
  assert.match(warning, /couldn't check/i);
  assert.match(warning, /Orchard/);
  assert.match(warning, /Archive anyway\?$/);
});
