import { test } from "node:test";
import assert from "node:assert/strict";
import { formatWorkshopDates } from "./workshop-dates.ts";
import { instantAt } from "./studio-time.ts";

const SG = "Asia/Singapore";
const SYDNEY = "Australia/Sydney";

// 09:00 Singapore on a date, as the API sends it.
const sg9am = (date: string) => new Date(`${date}T01:00:00Z`).toISOString();
// 09:00 Sydney on a date, as the API sends it.
const sydney9am = (date: string) => new Date(instantAt(SYDNEY, date, "09:00")).toISOString();

test("a workshop with no date reads TBA", () => {
  assert.equal(formatWorkshopDates(null, null, SG), "TBA");
});

test("a one-day workshop names its day with the year", () => {
  assert.equal(formatWorkshopDates(sg9am("2027-03-05"), "2027-03-05T01:15:00.000Z", SG), "Fri, 5 Mar 2027");
});

test("consecutive days read as one date to another", () => {
  const days = ["2027-03-05", "2027-03-06", "2027-03-07"].map(sg9am);
  assert.equal(formatWorkshopDates(days[0]!, "2027-03-07T10:00:00.000Z", SG, days), "Fri, 5 – Sun, 7 Mar 2027");
  // Without the days, the start to the end.
  assert.equal(formatWorkshopDates(days[0]!, "2027-03-07T10:00:00.000Z", SG), "Fri, 5 – Sun, 7 Mar 2027");
});

test("a run across a month names both months, and across a year both years", () => {
  assert.equal(
    formatWorkshopDates(sg9am("2027-03-30"), sg9am("2027-04-01"), SG),
    "Tue, 30 Mar – Thu, 1 Apr 2027",
  );
  assert.equal(
    formatWorkshopDates(sg9am("2026-12-31"), sg9am("2027-01-02"), SG),
    "Thu, 31 Dec 2026 – Sat, 2 Jan 2027",
  );
});

test("days with gaps between read as their runs", () => {
  const days = ["2026-08-15", "2026-08-16", "2026-08-22", "2026-08-23"].map(sg9am);
  assert.equal(
    formatWorkshopDates(days[0]!, days[3]!, SG, days),
    "Sat, 15 – Sun, 16 Aug · Sat, 22 – Sun, 23 Aug 2026",
  );
  const apart = ["2026-08-15", "2026-08-22"].map(sg9am);
  assert.equal(formatWorkshopDates(apart[0]!, apart[1]!, SG, apart), "Sat, 15 Aug · Sat, 22 Aug 2026");
});

test("dates are the studio's: just after midnight there is that day, not the UTC one before", () => {
  // 00:30 on 5 Mar in Singapore is still 4 Mar in UTC.
  assert.equal(formatWorkshopDates("2027-03-04T16:30:00.000Z", null, SG), "Fri, 5 Mar 2027");
});

test("TEN-94 a Sydney studio's workshop days are Sydney's: its 9 am starts name those days, and just after midnight there is that day, not Singapore's or UTC's", () => {
  const days = ["2027-03-05", "2027-03-06", "2027-03-07"].map(sydney9am);
  assert.equal(formatWorkshopDates(days[0]!, days[2]!, SYDNEY, days), "Fri, 5 – Sun, 7 Mar 2027");
  // 00:30 on Fri 5 Mar 2027 in Sydney (UTC+11) is 21:30 on the 4th in Singapore and 13:30 on the 4th in UTC.
  assert.equal(formatWorkshopDates("2027-03-04T13:30:00.000Z", null, SYDNEY), "Fri, 5 Mar 2027");
  assert.equal(formatWorkshopDates("2027-03-04T13:30:00.000Z", null, SG), "Thu, 4 Mar 2027");
  // Two days of one run either side of the 4 April 2027 end of daylight saving still read as consecutive.
  const across = ["2027-04-03", "2027-04-04", "2027-04-05"].map(sydney9am);
  assert.equal(formatWorkshopDates(across[0]!, across[2]!, SYDNEY, across), "Sat, 3 – Mon, 5 Apr 2027");
});
