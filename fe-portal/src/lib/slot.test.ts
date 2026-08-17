import assert from "node:assert";
import { slotFromParams, slotHref, type Slot } from "./schedule";

const slot: Slot = { date: "2026-08-17", start: "19:30", end: "20:30" };

// A slot picked off the grid survives the trip through the URL intact.
const href = slotHref("/admin/schedule/new/class", slot);
assert.deepStrictEqual(
  slotFromParams(new URLSearchParams(href.slice(href.indexOf("?")))),
  slot,
);

// Anything malformed reads as "no slot" — a bad value must never reach a date
// or time input, which would silently render blank.
assert.strictEqual(slotFromParams(new URLSearchParams("")), null);
assert.strictEqual(
  slotFromParams(new URLSearchParams("date=2026-08-17&start=19:30")),
  null,
);
assert.strictEqual(
  slotFromParams(new URLSearchParams("date=17-08-2026&start=19:30&end=20:30")),
  null,
);
// The end time the last grid slot used to emit before it was clamped.
assert.strictEqual(
  slotFromParams(new URLSearchParams("date=2026-08-17&start=23:30&end=24:30")),
  null,
);

console.log("slot.test ok");
