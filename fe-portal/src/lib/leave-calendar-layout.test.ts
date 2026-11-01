import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSON_PALETTE, dayDiff, layoutWeek, personColours, weeksOf } from "./leave-calendar-layout";

test("TEN-134 the leave calendar draws Monday-first weeks of plain days, a month only the rows it needs", () => {
  // October 2026 begins on a Thursday and ends on a Saturday: five rows, 28 September to 1 November.
  const month = weeksOf("month", "2026-10-17");
  assert.equal(month.length, 5);
  assert.deepEqual(month[0], ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.equal(month[4]![6], "2026-11-01");
  // February 2027 begins on a Monday and ends on a Sunday: exactly four rows, none of another month.
  const february = weeksOf("month", "2027-02-10");
  assert.equal(february.length, 4);
  assert.equal(february[0]![0], "2027-02-01");
  assert.equal(february[3]![6], "2027-02-28");
  // A week is the Monday-to-Sunday around the day, across a year end and Sydney's daylight-saving Sunday.
  assert.deepEqual(weeksOf("week", "2027-01-01"), [
    ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"],
  ]);
  assert.deepEqual(weeksOf("week", "2026-10-04")[0]![0], "2026-09-28");
  assert.equal(weeksOf("week", "2026-10-04")[0]![6], "2026-10-04");
});

// The leave calendar draws each absence as one bar across its days, stacked in
// lanes, one colour per person.

const away = (id: string, start_date: string, end_date: string) => ({
  staff: { id, name: id },
  start_date,
  end_date,
});

// 2026-09-28 is a Monday.
const WEEK = "2026-09-28";

test("days are counted between plain dates, across a month end", () => {
  assert.equal(dayDiff("2026-09-28", "2026-10-02"), 4);
  assert.equal(dayDiff("2026-10-02", "2026-09-28"), -4);
  assert.equal(dayDiff("2026-03-28", "2026-03-30"), 2);
});

test("an absence inside the week is one bar over its days", () => {
  const { segments, laneCount } = layoutWeek([away("a", "2026-09-29", "2026-10-01")], WEEK);
  assert.equal(laneCount, 1);
  assert.deepEqual(
    segments.map(({ startCol, span, continuesBefore, continuesAfter, lane }) => ({
      startCol, span, continuesBefore, continuesAfter, lane,
    })),
    [{ startCol: 1, span: 3, continuesBefore: false, continuesAfter: false, lane: 0 }],
  );
});

test("an absence longer than the week is cut at both edges and marked as continuing", () => {
  const { segments } = layoutWeek([away("a", "2026-09-20", "2026-10-10")], WEEK);
  assert.equal(segments[0].startCol, 0);
  assert.equal(segments[0].span, 7);
  assert.equal(segments[0].continuesBefore, true);
  assert.equal(segments[0].continuesAfter, true);
});

test("absences outside the week are left out", () => {
  const { segments, laneCount } = layoutWeek(
    [away("a", "2026-09-20", "2026-09-27"), away("b", "2026-10-05", "2026-10-06")],
    WEEK,
  );
  assert.equal(segments.length, 0);
  assert.equal(laneCount, 0);
});

test("overlapping absences stack; ones that don't overlap share a lane", () => {
  const { segments, laneCount } = layoutWeek(
    [
      away("a", "2026-09-28", "2026-09-30"),
      away("b", "2026-09-29", "2026-10-01"),
      away("c", "2026-10-02", "2026-10-03"),
    ],
    WEEK,
  );
  const lane = Object.fromEntries(segments.map((s) => [s.entry.staff.id, s.lane]));
  assert.deepEqual(lane, { a: 0, b: 1, c: 0 });
  assert.equal(laneCount, 2);
});

test("past the lane cap, absences are counted per day instead of drawn", () => {
  const { segments, laneCount, hidden } = layoutWeek(
    [
      away("a", "2026-09-28", "2026-09-29"),
      away("b", "2026-09-28", "2026-09-29"),
      away("c", "2026-09-28", "2026-09-29"),
      away("d", "2026-09-29", "2026-09-30"),
    ],
    WEEK,
    { maxLanes: 3 },
  );
  assert.equal(laneCount, 3);
  assert.deepEqual(segments.map((s) => s.entry.staff.id).sort(), ["a", "b", "c"]);
  assert.deepEqual(hidden, [0, 1, 1, 0, 0, 0, 0]);
});

test("a person picked out is laid out first, so the cap never hides them", () => {
  const entries = [
    away("a", "2026-09-28", "2026-09-28"),
    away("b", "2026-09-28", "2026-09-28"),
    away("c", "2026-09-28", "2026-09-28"),
    away("d", "2026-09-28", "2026-09-28"),
  ];
  const { segments } = layoutWeek(entries, WEEK, { maxLanes: 3, first: "d" });
  assert.equal(segments.find((s) => s.entry.staff.id === "d")?.lane, 0);
});

test("everyone in view gets a different colour, the same one each time", () => {
  const ids = Array.from({ length: PERSON_PALETTE.length + 3 }, (_, i) => `staff-${i}`);
  const colours = personColours(ids);
  assert.equal(new Set(colours.values()).size, ids.length);
  assert.deepEqual(personColours([...ids].reverse()), colours);
});
