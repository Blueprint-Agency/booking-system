import test from "node:test";
import assert from "node:assert";
import { defaultWorkshopLocationId } from "./workshop-location";

const FIRST = { id: "loc-first" };
const SECOND = { id: "loc-second" };

test("WSP-40 a new workshop starts on the Location staff are working in, not the first in the list", () => {
  assert.strictEqual(defaultWorkshopLocationId([FIRST, SECOND], SECOND.id), SECOND.id);
});

test("WSP-40 with no working Location, or one the form cannot offer, a new workshop starts on the first", () => {
  assert.strictEqual(defaultWorkshopLocationId([FIRST, SECOND], null), FIRST.id);
  assert.strictEqual(defaultWorkshopLocationId([FIRST, SECOND], "loc-archived"), FIRST.id);
  assert.strictEqual(defaultWorkshopLocationId([], SECOND.id), "");
});
