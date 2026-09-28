import { test } from "node:test";
import assert from "node:assert/strict";
import {
  breakdownLine,
  comparisonLine,
  durationLabel,
  emptyLine,
  headline,
  lifetimeLine,
  monthGrid,
  overviewLine,
  practiceBars,
  rangeLabel,
  rhythmSummary,
  streakLabel,
  studioToday,
  usualSlotLabel,
  workshopLine,
  type PracticeData,
} from "./practice.ts";

/** September 2026 as `period=month` answers it: a bucket per day. */
function september(overrides: Partial<PracticeData> = {}, days: Record<number, [number, number]> = {}): PracticeData {
  return {
    period: "month",
    from: "2026-09-01",
    to: "2026-09-30",
    attended: 13,
    attended_classes: 11,
    attended_pt: 2,
    attended_workshops: 1,
    previous_attended: 10,
    buckets: Array.from({ length: 30 }, (_, i) => {
      const [attended, booked] = days[i + 1] ?? [0, 0];
      return { starts_on: `2026-09-${String(i + 1).padStart(2, "0")}`, attended, booked };
    }),
    minutes: 825,
    streak_weeks: 9,
    usual_slot: { weekday: 2, hour: 7 },
    top_class_types: [
      { name: "Vinyasa Flow", attended: 7 },
      { name: "Hatha", attended: 4 },
    ],
    lifetime: { attended: 164, since: "2025-03-04" },
    last_attended_at: "2026-09-28T23:00:00Z",
    ...overrides,
  };
}

test("the headline counts sessions in the month, one of them singular", () => {
  const h = headline(september());
  assert.equal(`${h.count} ${h.label}`, "13 sessions in September");
  const one = headline(september({ attended: 1 }));
  assert.equal(`${one.count} ${one.label}`, "1 session in September");
});

test("the breakdown splits classes from private sessions and leaves out a part that is zero", () => {
  assert.equal(breakdownLine(11, 2), "11 classes · 2 private sessions");
  assert.equal(breakdownLine(1, 1), "1 class · 1 private session");
  assert.equal(breakdownLine(4, 0), "4 classes");
  assert.equal(breakdownLine(0, 3), "3 private sessions");
  assert.equal(breakdownLine(0, 0), null);
});

test("the month is compared with the one before, by name", () => {
  assert.equal(comparisonLine(september()), "3 more than August");
  assert.equal(comparisonLine(september({ previous_attended: 13 })), "Same as August");
  assert.equal(comparisonLine(september({ previous_attended: 15 })), "2 fewer than August");
  // January looks back to December.
  assert.equal(
    comparisonLine(september({ from: "2027-01-01", to: "2027-01-31", attended: 1, previous_attended: 0 })),
    "1 more than December",
  );
  assert.equal(comparisonLine(september({ previous_attended: null })), null);
});

test("workshops get a line of their own, and none when there were none", () => {
  assert.equal(workshopLine(september()), "Also 1 workshop in September");
  assert.equal(workshopLine(september({ attended_workshops: 2 })), "Also 2 workshops in September");
  assert.equal(workshopLine(september({ attended_workshops: 0 })), null);
});

test("time on the mat reads in hours and minutes", () => {
  assert.equal(durationLabel(825), "13 h 45 m");
  assert.equal(durationLabel(45), "45 m");
  assert.equal(durationLabel(120), "2 h");
  assert.equal(durationLabel(0), "0 m");
});

test("the usual slot is a short weekday and a 12-hour time", () => {
  assert.equal(usualSlotLabel({ weekday: 2, hour: 7 }), "Tue · 7am");
  assert.equal(usualSlotLabel({ weekday: 7, hour: 19 }), "Sun · 7pm");
  assert.equal(usualSlotLabel({ weekday: 1, hour: 12 }), "Mon · 12pm");
  assert.equal(usualSlotLabel({ weekday: 5, hour: 0 }), "Fri · 12am");
  assert.equal(usualSlotLabel(null), "—");
});

test("the streak is weeks in a row for the current period", () => {
  assert.equal(streakLabel(true), "Weeks in a row");
  assert.equal(streakLabel(false), "Longest run of weeks");
});

test("a month starting on a Tuesday has one blank before the 1st, and today is marked", () => {
  const grid = monthGrid(september({}, { 1: [1, 0], 12: [2, 0], 30: [0, 1] }), "2026-09-28");
  assert.equal(grid.leading, 1);
  assert.equal(grid.days.length, 30);
  assert.deepEqual(grid.days[0], { date: "2026-09-01", day: 1, attended: 1, booked: 0, today: false, future: false });
  assert.equal(grid.days[11]!.attended, 2);
  assert.equal(grid.days[27]!.today, true);
  assert.equal(grid.days.filter((d) => d.today).length, 1);
  // After today: the 29th has nothing booked and is left blank; the 30th has a booking.
  assert.equal(grid.days[28]!.future, true);
  assert.equal(grid.days[29]!.future, true);
  assert.equal(grid.days[29]!.booked, 1);
});

test("February in a leap year has 29 days, and a month starting on a Monday no blanks", () => {
  const feb = monthGrid(
    september({
      from: "2028-02-01",
      to: "2028-02-29",
      buckets: Array.from({ length: 29 }, (_, i) => ({
        starts_on: `2028-02-${String(i + 1).padStart(2, "0")}`,
        attended: 0,
        booked: 0,
      })),
    }),
    "2028-03-05",
  );
  // 1 February 2028 is a Tuesday.
  assert.equal(feb.leading, 1);
  assert.equal(feb.days.length, 29);
  assert.equal(feb.days.at(-1)!.date, "2028-02-29");
  assert.ok(feb.days.every((d) => !d.today && !d.future), "a month gone by has no today and nothing after it");

  const june = monthGrid(
    september({
      from: "2026-06-01",
      to: "2026-06-30",
      buckets: Array.from({ length: 30 }, (_, i) => ({
        starts_on: `2026-06-${String(i + 1).padStart(2, "0")}`,
        attended: 0,
        booked: 0,
      })),
    }),
    "2026-06-10",
  );
  assert.equal(june.leading, 0);
});

test("a month that ends on a Sunday and one that starts on a Sunday", () => {
  const november = monthGrid(
    september({
      from: "2026-11-01",
      to: "2026-11-30",
      buckets: Array.from({ length: 30 }, (_, i) => ({
        starts_on: `2026-11-${String(i + 1).padStart(2, "0")}`,
        attended: 0,
        booked: 0,
      })),
    }),
    "2026-11-02",
  );
  // 1 November 2026 is a Sunday: six blanks, Monday first.
  assert.equal(november.leading, 6);
});

test("the range, the empty month and the chart's text equivalent name the month", () => {
  assert.equal(rangeLabel(september()), "September 2026");
  assert.equal(emptyLine(september({ attended: 0 })), "No sessions in September yet.");
  assert.equal(
    rhythmSummary(september({}, { 30: [0, 1] })),
    "13 sessions attended in September 2026, and 1 booked.",
  );
  assert.equal(
    rhythmSummary(september({ attended: 1 })),
    "1 session attended in September 2026.",
  );
});

test("the bars are the class types, then private sessions when there are any, against the largest", () => {
  assert.deepEqual(practiceBars(september()), [
    { name: "Vinyasa Flow", attended: 7, share: 1 },
    { name: "Hatha", attended: 4, share: 4 / 7 },
    { name: "Private sessions", attended: 2, share: 2 / 7 },
  ]);
  assert.deepEqual(practiceBars(september({ attended_pt: 0 })).map((b) => b.name), ["Vinyasa Flow", "Hatha"]);
  assert.deepEqual(practiceBars(september({ top_class_types: [], attended_pt: 1 })), [
    { name: "Private session", attended: 1, share: 1 },
  ]);
});

test("the lifetime line counts every session since the month of the first, or waits for the first", () => {
  assert.equal(lifetimeLine({ attended: 164, since: "2025-03-04" }), "164 sessions since March 2025");
  assert.equal(lifetimeLine({ attended: 1, since: "2026-09-02" }), "1 session since September 2026");
  assert.equal(lifetimeLine({ attended: 0, since: null }), "Your first class will show here");
});

test("the overview line is the lifetime total and this month's, and nothing before the first session", () => {
  assert.equal(overviewLine(september()), "164 sessions · 13 this month");
  assert.equal(overviewLine(september({ lifetime: { attended: 1, since: "2026-09-02" }, attended: 1 })), "1 session · 1 this month");
  assert.equal(overviewLine(september({ lifetime: { attended: 0, since: null }, attended: 0 })), null);
});

test("today is the studio's calendar day", () => {
  // 00:30 on 1 October in Singapore; still 30 September in UTC.
  assert.equal(studioToday(Date.parse("2026-09-30T16:30:00Z")), "2026-10-01");
});
