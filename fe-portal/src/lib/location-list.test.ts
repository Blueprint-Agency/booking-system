import test from "node:test";
import assert from "node:assert";
import {
  assertLoadedInFull,
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

test("LOC-18 saving a location refuses a row that did not come from the full list, so no blank phone or Maps link can be sent over the real ones", () => {
  // The short list's row for `a` has a blank phone; the full list's has the real one.
  assert.throws(() => assertLoadedInFull(null, short[0]!), /full list/i);
  assert.throws(() => assertLoadedInFull(full, row("zzz", "Not in the list")), /full list/i);
  assert.doesNotThrow(() => assertLoadedInFull(full, full[0]!));
});

test("LOC-19 once the full list has loaded, every location, archived ones included, can be edited as before", () => {
  assert.strictEqual(mayEditLocations("loaded"), true);
  assert.deepStrictEqual(locationsToManage("loaded", full), full);
});

test("LOC-19 the workspace switcher keeps listing the studio's locations from the short list when the full list is missing, and from the full list once it is there", () => {
  assert.deepStrictEqual(workspaceLocations(short, null), short);
  assert.deepStrictEqual(workspaceLocations(short, full), full);
});
