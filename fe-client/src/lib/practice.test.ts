import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandSummary,
  bucketLabels,
  classesCount,
  comparisonLine,
  emptyLine,
  lastClassLine,
  punches,
  type PracticeBucket,
} from "./practice.ts";

test("the comparison names the period before, in words", () => {
  assert.equal(comparisonLine("month", 5, 2), "3 more than last month");
  assert.equal(comparisonLine("month", 4, 4), "Same as last month");
  assert.equal(comparisonLine("month", 1, 3), "2 fewer than last month");
  assert.equal(comparisonLine("quarter", 9, 8), "1 more than the 3 months before");
  assert.equal(comparisonLine("year", 0, 12), "12 fewer than last year");
});

test("all time has nothing to compare against", () => {
  assert.equal(comparisonLine("all", 40, null), null);
});

test("the count reads as classes, one of them singular", () => {
  assert.equal(classesCount(14), "14 classes");
  assert.equal(classesCount(1), "1 class");
  assert.equal(classesCount(0), "0 classes");
});

test("a column punches up to eight holes, then says how many more", () => {
  assert.deepEqual(punches(0), { holes: 0, more: 0 });
  assert.deepEqual(punches(8), { holes: 8, more: 0 });
  assert.deepEqual(punches(11), { holes: 8, more: 3 });
});

const weeks = (...days: string[]): PracticeBucket[] => days.map((starts_on) => ({ starts_on, attended: 0 }));

test("a month's weeks are labelled by their first day", () => {
  assert.deepEqual(bucketLabels("month", weeks("2026-09-01", "2026-09-07", "2026-09-14")), [
    "1 Sep",
    "7 Sep",
    "14 Sep",
  ]);
});

test("three months of weeks name each month once, at its first week, so thirteen columns fit a phone", () => {
  assert.deepEqual(
    bucketLabels("quarter", weeks("2026-07-01", "2026-07-06", "2026-07-27", "2026-08-03", "2026-08-10", "2026-09-07")),
    ["Jul", null, null, "Aug", null, "Sep"],
  );
});

test("a year's buckets are months and all time's are years", () => {
  assert.deepEqual(bucketLabels("year", weeks("2026-01-01", "2026-02-01", "2026-12-01")), ["Jan", "Feb", "Dec"]);
  assert.deepEqual(bucketLabels("all", weeks("2024-11-20", "2025-01-01", "2026-01-01")), ["2024", "2025", "2026"]);
});

test("the band's text equivalent lists every bucket's count", () => {
  const buckets: PracticeBucket[] = [
    { starts_on: "2026-09-01", attended: 2 },
    { starts_on: "2026-09-07", attended: 0 },
    { starts_on: "2026-09-14", attended: 1 },
  ];
  assert.deepEqual(bandSummary("month", buckets), [
    "Week of 1 Sep: 2 classes",
    "Week of 7 Sep: no classes",
    "Week of 14 Sep: 1 class",
  ]);
  assert.deepEqual(bandSummary("year", [{ starts_on: "2026-03-01", attended: 4 }]), ["March: 4 classes"]);
  assert.deepEqual(bandSummary("all", [{ starts_on: "2025-01-01", attended: 40 }]), ["2025: 40 classes"]);
});

test("the empty state says which timeframe is empty", () => {
  assert.equal(emptyLine("month"), "No classes attended this month.");
  assert.equal(emptyLine("quarter"), "No classes attended in the last 3 months.");
  assert.equal(emptyLine("year"), "No classes attended this year.");
  assert.equal(emptyLine("all"), "No classes attended yet.");
});

test("the last class is its weekday and date in studio time", () => {
  // 00:30 on Friday 12 June in Singapore; still Thursday in UTC.
  assert.equal(lastClassLine("2026-06-11T16:30:00Z"), "Last class Fri 12 Jun");
});
