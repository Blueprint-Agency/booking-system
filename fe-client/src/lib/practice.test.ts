import { test } from "node:test";
import assert from "node:assert/strict";
import {
  comparisonLine,
  dayTitle,
  durationParts,
  emptyLine,
  headline,
  isCurrent,
  monthGrid,
  practiceSplit,
  rangeLabel,
  rhythmSummary,
  stepAnchor,
  practisedFigure,
  studioToday,
  totalParts,
  weekDays,
  yearColumns,
  type FigureParts,
  type PracticeData,
} from "./practice.ts";

/** September 2026 as `period=month` answers it: a bucket per day. */
function september(overrides: Partial<PracticeData> = {}, days: Record<number, [number, number]> = {}): PracticeData {
  return {
    period: "month",
    from: "2026-09-01",
    to: "2026-09-30",
    has_previous: true,
    has_next: false,
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

test("the headline counts sessions, one of them singular, and leaves the period to the stepper", () => {
  const h = headline(september());
  assert.equal(`${h.count} ${h.label}`, "13 sessions");
  const one = headline(september({ attended: 1 }));
  assert.equal(`${one.count} ${one.label}`, "1 session");
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


/** A figure as it reads: each number with its unit after it. */
const read = (parts: FigureParts) => parts.map((p) => `${p.value}${p.unit && ` ${p.unit}`}`).join(" ");

test("time on the mat reads in hours and minutes, each number with its unit", () => {
  assert.deepEqual(durationParts(825), [
    { value: "13", unit: "h" },
    { value: "45", unit: "m" },
  ]);
  assert.equal(read(durationParts(45)), "45 m");
  assert.equal(read(durationParts(120)), "2 h");
  assert.equal(read(durationParts(0)), "0 m");
});

test("the total counts classes, private sessions and workshops alike", () => {
  // 11 classes and 2 private sessions, and 1 workshop.
  assert.equal(read(totalParts(september())), "14 sessions");
  assert.equal(read(totalParts(september({ attended_workshops: 0 }))), "13 sessions");
  assert.equal(read(totalParts(september({ attended: 0, attended_workshops: 1 }))), "1 session");
});

test("days practised counts the days attended on, not the sessions or what is only booked", () => {
  const month = practisedFigure(september({}, { 1: [1, 0], 12: [2, 0], 30: [0, 1] }));
  assert.equal(month.label, "Days practised");
  assert.equal(read(month.parts), "2 days");
  assert.equal(read(practisedFigure(september({}, { 5: [1, 0] })).parts), "1 day");
  assert.equal(read(practisedFigure(week({}, { 0: [1, 0], 2: [0, 1] })).parts), "1 day");
});

test("a year, bucketed by month, counts the months practised", () => {
  const y = practisedFigure(year({}, [9, 11, 0, 8]));
  assert.equal(y.label, "Months practised");
  assert.equal(read(y.parts), "3 months");
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

test("the split is the class types, private sessions, then workshops, each a share of all of them", () => {
  assert.deepEqual(practiceSplit(september()), [
    { name: "Vinyasa Flow", kind: "class", attended: 7, share: 7 / 14, percent: 50 },
    { name: "Hatha", kind: "class", attended: 4, share: 4 / 14, percent: 29 },
    { name: "Private sessions", kind: "pt", attended: 2, share: 2 / 14, percent: 14 },
    { name: "Workshop", kind: "workshop", attended: 1, share: 1 / 14, percent: 7 },
  ]);
  assert.equal(practiceSplit(september({ attended_workshops: 3 })).at(-1)!.name, "Workshops");
  assert.ok(practiceSplit(september({ attended_workshops: 0 })).every((p) => p.kind !== "workshop"));
  // Equal parts read as equal shares, not as bars all full.
  const thirds = practiceSplit(
    september({
      attended_classes: 3,
      attended_pt: 0,
      attended_workshops: 0,
      top_class_types: [
        { name: "Ashtanga Led", attended: 1 },
        { name: "Core And Strength", attended: 1 },
        { name: "Mobility Stretch", attended: 1 },
      ],
    }),
  );
  assert.deepEqual(thirds.map((p) => p.percent), [33, 33, 33]);
  assert.equal(practiceSplit(september({ top_class_types: [], attended_classes: 0, attended_pt: 1 }))[0]!.name, "Private session");
});

test("classes past the top few are one part, so the split fills the bar", () => {
  const parts = practiceSplit(september({ attended_classes: 14 }));
  assert.deepEqual(parts.map((p) => [p.name, p.attended]), [
    ["Vinyasa Flow", 7],
    ["Hatha", 4],
    ["Other classes", 3],
    ["Private sessions", 2],
    ["Workshop", 1],
  ]);
  assert.ok(Math.abs(parts.reduce((n, p) => n + p.share, 0) - 1) < 1e-9);
});


/** The week of Monday 28 September 2026 as `period=week` answers it. */
function week(overrides: Partial<PracticeData> = {}, days: Record<number, [number, number]> = {}): PracticeData {
  const dates = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
  return september({
    period: "week",
    from: dates[0],
    to: dates[6],
    attended: 1,
    attended_classes: 1,
    attended_pt: 0,
    attended_workshops: 0,
    previous_attended: 4,
    buckets: dates.map((starts_on, i) => {
      const [attended, booked] = days[i] ?? [0, 0];
      return { starts_on, attended, booked };
    }),
    sessions: [],
    ...overrides,
  });
}

/** 2026 as `period=year` answers it: a bucket per month. */
function year(overrides: Partial<PracticeData> = {}, months: number[] = []): PracticeData {
  return september({
    period: "year",
    from: "2026-01-01",
    to: "2026-12-31",
    attended: 93,
    previous_attended: 95,
    buckets: Array.from({ length: 12 }, (_, i) => ({
      starts_on: `2026-${String(i + 1).padStart(2, "0")}-01`,
      attended: months[i] ?? 0,
      booked: 0,
    })),
    ...overrides,
  });
}

test("the range states the period's dates: a week, a month, a year", () => {
  assert.equal(rangeLabel(week()), "28 Sep – 4 Oct");
  assert.equal(rangeLabel(week({ from: "2026-09-21", to: "2026-09-27" })), "21 – 27 Sep");
  assert.equal(rangeLabel(week({ from: "2025-12-29", to: "2026-01-04" })), "29 Dec 2025 – 4 Jan 2026");
  assert.equal(rangeLabel(september()), "September 2026");
  assert.equal(rangeLabel(year()), "2026");
});

test("each period is compared with the one before it, by name", () => {
  assert.equal(comparisonLine(week({ attended: 4, previous_attended: 1 })), "3 more than last week");
  assert.equal(comparisonLine(week({ attended: 4, previous_attended: 4 })), "Same as last week");
  // A week that has passed looks back to the week before it, not to last week.
  assert.equal(comparisonLine(week({ has_next: true, attended: 2, previous_attended: 3 })), "1 fewer than the week before");
  assert.equal(comparisonLine(september()), "3 more than August");
  assert.equal(comparisonLine(year()), "2 fewer than 2025");
  assert.equal(comparisonLine(year({ previous_attended: 93 })), "Same as 2025");
});

test("the empty state names the period", () => {
  assert.equal(emptyLine(week({ attended: 0 })), "No sessions this week yet.");
  assert.equal(emptyLine(year({ attended: 0 })), "No sessions in 2026 yet.");
  // A period that has passed is not waiting for anything.
  assert.equal(emptyLine(september({ attended: 0, from: "2026-08-01", to: "2026-08-31", has_next: true })), "No sessions in August.");
  assert.equal(emptyLine(week({ attended: 0, has_next: true })), "No sessions that week.");
});

test("the period is current until a later one can be stepped to", () => {
  assert.equal(isCurrent(september()), true);
  assert.equal(isCurrent(year({ has_next: true })), false);
});

test("stepping asks for the day before the period opens, or the day after it closes", () => {
  assert.equal(stepAnchor(week(), -1), "2026-09-27");
  assert.equal(stepAnchor(week(), 1), "2026-10-05");
  assert.equal(stepAnchor(september(), -1), "2026-08-31");
  assert.equal(stepAnchor(year(), -1), "2025-12-31");
  assert.equal(stepAnchor(year(), 1), "2027-01-01");
  // 1 March 2028 steps back into a leap February.
  assert.equal(stepAnchor(september({ from: "2028-03-01", to: "2028-03-31" }), -1), "2028-02-29");
});

test("the chart's text equivalent names a week by its dates and a year by its number", () => {
  assert.equal(rhythmSummary(week({}, { 0: [1, 0], 2: [0, 1], 5: [0, 1] })), "1 session attended in the week of 28 Sep – 4 Oct, and 2 booked.");
  assert.equal(rhythmSummary(year()), "93 sessions attended in 2026.");
});

test("the week is Monday to Sunday, today marked, the days after it with nothing booked left blank", () => {
  const days = weekDays(week({}, { 0: [1, 0], 2: [0, 1] }), "2026-09-28");
  assert.deepEqual(
    days.map((d) => d.weekday),
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  );
  assert.deepEqual(days[0], { date: "2026-09-28", weekday: "Mon", attended: 1, booked: 0, today: true, future: false });
  assert.deepEqual(days[2], { date: "2026-09-30", weekday: "Wed", attended: 0, booked: 1, today: false, future: true });
  assert.equal(days.filter((d) => d.future).length, 6);
  // A past week has no today and no future.
  const lastWeek = week({ from: "2026-09-21", to: "2026-09-27", has_next: true });
  lastWeek.buckets = Array.from({ length: 7 }, (_, i) => ({ starts_on: `2026-09-${21 + i}`, attended: 0, booked: 0 }));
  const past = weekDays(lastWeek, "2026-09-28");
  assert.equal(past[6]!.date, "2026-09-27");
  assert.ok(past.every((d) => !d.today && !d.future));
});

test("a day's title names its weekday, day and month", () => {
  assert.equal(dayTitle("2026-09-23"), "Wednesday 23 September");
  assert.equal(dayTitle("2026-10-04"), "Sunday 4 October");
});

test("the year is a column per month, the months after this one marked future", () => {
  const cols = yearColumns(year({}, [9, 11, 8, 12, 10, 7, 13, 10, 13]), "2026-09-28");
  assert.equal(cols.length, 12);
  assert.deepEqual(cols[0], { month: "2026-01-01", initial: "J", name: "January", attended: 9, booked: 0, current: false, future: false });
  assert.deepEqual(cols[8], { month: "2026-09-01", initial: "S", name: "September", attended: 13, booked: 0, current: true, future: false });
  assert.deepEqual(
    cols.map((c) => c.future),
    [false, false, false, false, false, false, false, false, false, true, true, true],
  );
  // A past year has no current month and nothing to come.
  const lastYear = year({ from: "2025-01-01", to: "2025-12-31", has_next: true });
  lastYear.buckets = lastYear.buckets.map((b) => ({ ...b, starts_on: b.starts_on.replace("2026", "2025") }));
  const past = yearColumns(lastYear, "2026-09-28");
  assert.equal(past[0]!.month, "2025-01-01");
  assert.ok(past.every((c) => !c.current && !c.future));
});

test("today is the studio's calendar day", () => {
  // 00:30 on 1 October in Singapore; still 30 September in UTC.
  assert.equal(studioToday(Date.parse("2026-09-30T16:30:00Z")), "2026-10-01");
});
