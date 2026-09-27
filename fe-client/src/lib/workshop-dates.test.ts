import { test } from "node:test";
import assert from "node:assert/strict";
import { formatWorkshopDates } from "./workshop-dates.ts";

// 09:00 Singapore on a date, as the API sends it.
const sg9am = (date: string) => new Date(`${date}T01:00:00Z`).toISOString();

test("a workshop with no date reads TBA", () => {
  assert.equal(formatWorkshopDates(null, null), "TBA");
});

test("a one-day workshop names its day with the year", () => {
  assert.equal(formatWorkshopDates(sg9am("2027-03-05"), "2027-03-05T01:15:00.000Z"), "Fri, 5 Mar 2027");
});

test("consecutive days read as one date to another", () => {
  const days = ["2027-03-05", "2027-03-06", "2027-03-07"].map(sg9am);
  assert.equal(formatWorkshopDates(days[0]!, "2027-03-07T10:00:00.000Z", days), "Fri, 5 – Sun, 7 Mar 2027");
  // Without the days, the start to the end.
  assert.equal(formatWorkshopDates(days[0]!, "2027-03-07T10:00:00.000Z"), "Fri, 5 – Sun, 7 Mar 2027");
});

test("a run across a month names both months, and across a year both years", () => {
  assert.equal(
    formatWorkshopDates(sg9am("2027-03-30"), sg9am("2027-04-01")),
    "Tue, 30 Mar – Thu, 1 Apr 2027",
  );
  assert.equal(
    formatWorkshopDates(sg9am("2026-12-31"), sg9am("2027-01-02")),
    "Thu, 31 Dec 2026 – Sat, 2 Jan 2027",
  );
});

test("days with gaps between read as their runs", () => {
  const days = ["2026-08-15", "2026-08-16", "2026-08-22", "2026-08-23"].map(sg9am);
  assert.equal(
    formatWorkshopDates(days[0]!, days[3]!, days),
    "Sat, 15 – Sun, 16 Aug · Sat, 22 – Sun, 23 Aug 2026",
  );
  const apart = ["2026-08-15", "2026-08-22"].map(sg9am);
  assert.equal(formatWorkshopDates(apart[0]!, apart[1]!, apart), "Sat, 15 Aug · Sat, 22 Aug 2026");
});

test("dates are Singapore's: just after midnight there is that day, not the UTC one before", () => {
  // 00:30 on 5 Mar in Singapore is still 4 Mar in UTC.
  assert.equal(formatWorkshopDates("2027-03-04T16:30:00.000Z", null), "Fri, 5 Mar 2027");
});
