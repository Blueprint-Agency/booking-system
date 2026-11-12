import test from "node:test";
import assert from "node:assert/strict";
import { listWeeks, weeksOpenAtFirst } from "./schedule-list";

const SYDNEY = "Australia/Sydney";
const SINGAPORE = "Asia/Singapore";

const at = (startsAt: string, id = startsAt) => ({ id, startsAt });

test("SCH-48 the list view lays a month out in its weeks, Monday to Sunday cut to the month, with only the days that have something on", () => {
  // August 2026 begins on a Saturday and ends on a Monday.
  const weeks = listWeeks(
    [
      at("2026-08-12T02:00:00.000Z", "wed-late"),
      at("2026-08-12T01:00:00.000Z", "wed-early"),
      at("2026-08-01T01:00:00.000Z", "sat-1st"),
      at("2026-08-31T01:00:00.000Z", "mon-31st"),
      // Either side of the month: not listed.
      at("2026-07-31T01:00:00.000Z", "july"),
      at("2026-09-01T01:00:00.000Z", "september"),
    ],
    SINGAPORE,
    "2026-08-20",
  );
  assert.deepEqual(
    weeks.map((w) => [w.key, w.first, w.last, w.count]),
    [
      ["2026-07-27", "2026-08-01", "2026-08-02", 1],
      ["2026-08-03", "2026-08-03", "2026-08-09", 0],
      ["2026-08-10", "2026-08-10", "2026-08-16", 2],
      ["2026-08-17", "2026-08-17", "2026-08-23", 0],
      ["2026-08-24", "2026-08-24", "2026-08-30", 0],
      ["2026-08-31", "2026-08-31", "2026-08-31", 1],
    ],
  );
  // A day's entries soonest first, and a quiet week has no days.
  assert.deepEqual(
    weeks[2]!.days.map((d) => [d.day, d.entries.map((e) => e.id)]),
    [["2026-08-12", ["wed-early", "wed-late"]]],
  );
  assert.deepEqual(weeks[1]!.days, []);
});

test("SCH-48 an entry is listed under the studio's day, so a 00:30 class in Sydney on the 1st is in that month, not the one before", () => {
  // 00:30 on 1 September in Sydney is 14:30 on 31 August in UTC.
  const entry = at("2026-08-31T14:30:00.000Z");
  const september = listWeeks([entry], SYDNEY, "2026-09-10");
  assert.equal(september[0]!.days[0]!.day, "2026-09-01");
  assert.equal(listWeeks([entry], SYDNEY, "2026-08-10").reduce((n, w) => n + w.count, 0), 0);
  assert.equal(listWeeks([entry], SINGAPORE, "2026-08-10").reduce((n, w) => n + w.count, 0), 1);
});

test("SCH-48 the month holding today opens on the weeks still to come; any other month opens whole", () => {
  const weeks = listWeeks([], SINGAPORE, "2026-08-20");
  assert.deepEqual(
    [...weeksOpenAtFirst(weeks, "2026-08-18")],
    ["2026-08-17", "2026-08-24", "2026-08-31"],
  );
  // Sunday is still its week.
  assert.ok(weeksOpenAtFirst(weeks, "2026-08-23").has("2026-08-17"));
  assert.equal(weeksOpenAtFirst(weeks, "2026-09-02").size, weeks.length);
  assert.equal(weeksOpenAtFirst(weeks, "2026-07-02").size, weeks.length);
});
