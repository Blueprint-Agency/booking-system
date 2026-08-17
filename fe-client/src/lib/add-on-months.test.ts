import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, addDays } from "date-fns";
import { roundsUpAPartMonth } from "./add-on-months.ts";

test("the part-months sentence only fires when a part month was rounded up", () => {
  const now = new Date("2026-08-17T09:14:33.412Z");

  // A plan bought seconds ago: the server quotes its full Duration, so the
  // charged months land exactly on the plan's end and nothing is rounded up.
  // The old millisecond-equality test failed here for every plan.
  assert.equal(roundsUpAPartMonth(addMonths(now, 6), 6, now), false);
  // ...and still false when the two Dates disagree by less than a day, which
  // is the only reason the equality test never held.
  const fiveSecondsOff = new Date(addMonths(now, 6).getTime() - 5000);
  assert.equal(roundsUpAPartMonth(fiveSecondsOff, 6, now), false);

  // A part-used plan: 3 months and 10 days of cover left is charged as 4 whole
  // months, so the member is owed the sentence.
  const partUsed = addDays(addMonths(now, 3), 10);
  assert.equal(roundsUpAPartMonth(partUsed, 4, now), true);
  // One whole day over is the boundary, and it counts.
  assert.equal(roundsUpAPartMonth(addDays(addMonths(now, 4), -1), 4, now), true);

  // A Dormant plan quotes 0 months against nothing to count back from — no
  // arithmetic to explain, so no sentence.
  assert.equal(roundsUpAPartMonth(now, 0, now), false);
});
