import test from "node:test";
import assert from "node:assert";
import { dropDrafts, noDrafts, shownDay, typeDay } from "./date-range-draft";

const range = { from: "2026-10-01", to: "2026-10-30" };

// FIN-58: typing a year key by key makes a browser pass through 0002-…, 0020-…
// and 0202-… before 2025-…; each must stay on screen without reaching the filter.
test("FIN-58 a partial year is held as a draft, shown, and not committed", () => {
  const first = typeDay(range, noDrafts(range), "from", "0002-10-01");
  assert.equal(first.commit, undefined);
  assert.equal(shownDay(range, first.drafts, "from"), "0002-10-01");
  assert.equal(shownDay(range, first.drafts, "to"), "2026-10-30");
});

test("FIN-58 a year typed key by key commits once it is complete", () => {
  let drafts = noDrafts(range);
  for (const typed of ["0002-10-01", "0020-10-01", "0202-10-01"]) {
    const step = typeDay(range, drafts, "from", typed);
    assert.equal(step.commit, undefined, typed);
    assert.equal(shownDay(range, step.drafts, "from"), typed);
    drafts = step.drafts;
  }
  const done = typeDay(range, drafts, "from", "2025-10-01");
  assert.deepEqual(done.commit, { from: "2025-10-01", to: "2026-10-30" });
  assert.equal(shownDay(done.commit!, done.drafts, "from"), "2025-10-01");
});

test("FIN-58 a complete day below 1900 is a draft too, never a committed period", () => {
  const step = typeDay(range, noDrafts(range), "to", "0001-01-01");
  assert.equal(step.commit, undefined);
  assert.equal(shownDay(range, step.drafts, "to"), "0001-01-01");
});

test("FIN-58 a day picked after the end swaps the endpoints, as before", () => {
  const step = typeDay(range, noDrafts(range), "from", "2027-01-01");
  assert.deepEqual(step.commit, { from: "2026-10-30", to: "2027-01-01" });
});

test("FIN-58 typing while All time is selected starts from the typed day", () => {
  const partial = typeDay(null, noDrafts(null), "from", "0002-10-01");
  assert.equal(partial.commit, undefined);
  assert.equal(shownDay(null, partial.drafts, "from"), "0002-10-01");
  const done = typeDay(null, partial.drafts, "from", "2025-10-01");
  assert.deepEqual(done.commit, { from: "2025-10-01", to: "2025-10-01" });
});

test("FIN-58 a draft is dropped when the committed period changes or the input loses focus", () => {
  const step = typeDay(range, noDrafts(range), "from", "0002-10-01");
  const preset = { from: "2026-10-30", to: "2026-10-30" };
  assert.equal(shownDay(preset, step.drafts, "from"), "2026-10-30");
  assert.equal(shownDay(range, dropDrafts(range), "from"), "2026-10-01");
});

test("FIN-58 an unchanged-by-value period keeps the draft, so a re-render does not wipe typing", () => {
  const step = typeDay(range, noDrafts(range), "from", "0002-10-01");
  const sameValueNewObject = { ...range };
  assert.equal(shownDay(sameValueNewObject, step.drafts, "from"), "0002-10-01");
});
