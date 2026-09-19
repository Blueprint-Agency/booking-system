import assert from "node:assert";
import { seriesCadence, weekdayOf } from "./series";

// A slot picked on the grid seeds the series' weekday from its date
// (ISO: Monday 1 … Sunday 7), whatever the browser's timezone.
assert.strictEqual(weekdayOf("2026-10-05"), 1);
assert.strictEqual(weekdayOf("2026-10-11"), 7);

assert.strictEqual(
  seriesCadence({ weekday: 1, start_time: "19:00", end_time: "20:00" }),
  "Mondays 19:00–20:00",
);
