import { test } from "node:test";
import assert from "node:assert/strict";
import { groupWorkshops, isHappeningNow } from "./workshop-groups.ts";

// 27 Sep 2026, 10:00 in Singapore.
const NOW = Date.parse("2026-09-27T02:00:00Z");

function w(id: string, starts_at: string | null, ends_at: string | null = null) {
  return { id, starts_at, ends_at };
}

const shape = (groups: ReturnType<typeof groupWorkshops<ReturnType<typeof w>>>) =>
  groups.map((g) => [g.label, g.items.map((i) => i.id)]);

test("an ended workshop is left out, and one still running comes first", () => {
  const groups = groupWorkshops(
    [
      w("later", "2026-09-30T01:00:00Z", "2026-09-30T04:00:00Z"),
      w("ended", "2026-09-20T01:00:00Z", "2026-09-21T04:00:00Z"),
      w("running", "2026-09-26T01:00:00Z", "2026-09-28T04:00:00Z"),
      w("single-day-past", "2026-09-01T01:00:00Z"),
    ],
    NOW,
  );
  assert.deepEqual(shape(groups), [
    ["Happening now", ["running"]],
    ["This month", ["later"]],
  ]);
});

test("upcoming workshops are grouped by month, soonest first, naming the year only when it differs", () => {
  const groups = groupWorkshops(
    [
      w("jan", "2027-01-10T01:00:00Z"),
      w("oct-b", "2026-10-20T01:00:00Z"),
      w("oct-a", "2026-10-02T01:00:00Z"),
    ],
    NOW,
  );
  assert.deepEqual(shape(groups), [
    ["October", ["oct-a", "oct-b"]],
    ["January 2027", ["jan"]],
  ]);
});

test("months are the studio's: just after midnight on the 1st in Singapore is that month", () => {
  // 1 Oct 00:30 in Singapore is still 30 Sep in UTC.
  const groups = groupWorkshops([w("first", "2026-09-30T16:30:00Z")], NOW);
  assert.deepEqual(shape(groups), [["October", ["first"]]]);
});

test("a workshop with no date yet goes last", () => {
  const groups = groupWorkshops([w("tba", null), w("oct", "2026-10-02T01:00:00Z")], NOW);
  assert.deepEqual(shape(groups), [
    ["October", ["oct"]],
    ["Dates to be announced", ["tba"]],
  ]);
});

test("a workshop is happening now from its start until its end", () => {
  assert.equal(isHappeningNow(w("a", "2026-09-27T01:00:00Z", "2026-09-27T05:00:00Z"), NOW), true);
  assert.equal(isHappeningNow(w("b", "2026-09-27T03:00:00Z", "2026-09-27T05:00:00Z"), NOW), false);
  assert.equal(isHappeningNow(w("c", "2026-09-26T01:00:00Z", "2026-09-27T01:00:00Z"), NOW), false);
});
