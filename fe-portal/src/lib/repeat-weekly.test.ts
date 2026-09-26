import assert from "node:assert";
import {
  createClassesLabel,
  lastDateLimit,
  repeatWeeklyFromParams,
  repeatWeeklyHref,
} from "./repeat-weekly";
import { repeatsEvery } from "./series";

// Repeat weekly takes its weekday from the first date, whatever the browser's
// timezone: 6 Oct 2026 is a Tuesday, 11 Oct a Sunday.
assert.strictEqual(repeatsEvery("2026-10-06"), "Every Tuesday");
assert.strictEqual(repeatsEvery("2026-10-11"), "Every Sunday");
// No first date yet, nothing to repeat on.
assert.strictEqual(repeatsEvery(""), null);

// The submit says what the click makes: one class, or N once the dates are previewed.
assert.strictEqual(createClassesLabel(false, null), "Create class");
assert.strictEqual(createClassesLabel(true, null), "Create classes");
assert.strictEqual(createClassesLabel(true, 1), "Create 1 class");
assert.strictEqual(createClassesLabel(true, 12), "Create 12 classes");
assert.strictEqual(createClassesLabel(true, 0), "Create 0 classes");

// The last date can be at most a year after the first (the backend's 366-day range).
assert.strictEqual(lastDateLimit("2026-10-06"), "2027-10-06");
assert.strictEqual(lastDateLimit("2027-03-01"), "2028-02-29");
assert.strictEqual(lastDateLimit(""), "");

// The old series link opens the class screen with Repeat weekly on, keeping the slot.
const href = repeatWeeklyHref(new URLSearchParams("date=2026-10-06&start=19:00&end=20:00"));
assert.strictEqual(href, "/admin/schedule/new/class?date=2026-10-06&start=19%3A00&end=20%3A00&repeat=weekly");
assert.strictEqual(repeatWeeklyFromParams(new URLSearchParams(href.slice(href.indexOf("?")))), true);
assert.strictEqual(repeatWeeklyHref(new URLSearchParams("")), "/admin/schedule/new/class?repeat=weekly");
assert.strictEqual(repeatWeeklyFromParams(new URLSearchParams("date=2026-10-06")), false);

console.log("repeat-weekly.test ok");
