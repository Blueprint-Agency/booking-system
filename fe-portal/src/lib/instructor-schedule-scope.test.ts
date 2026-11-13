import test from "node:test";
import assert from "node:assert";
import { matchesStudioFilters, parseScope } from "./instructor-schedule-scope";
import { myScheduleRow } from "./my-schedule";
import { scheduleEntryFromApi, type ApiScheduleEntry } from "./schedule-entry";

const ME = "staff-me";
const OTHER = "staff-other";

/** An entry as the Instructor's `GET /schedule/studio` sends it, through the calendar's mapping. */
function entry(overrides: Partial<ApiScheduleEntry> = {}) {
  return scheduleEntryFromApi({
    kind: "class",
    id: "class-1",
    workshop_id: null,
    label: "Morning Flow",
    subtitle: null,
    class_type_id: "ct-1",
    main_instructor_id: OTHER,
    supporting_instructor_ids: [],
    instructor_ids: [OTHER],
    location_id: "loc-1",
    room_id: null,
    starts_at: "2026-11-12T02:00:00.000Z",
    ends_at: "2026-11-12T03:00:00.000Z",
    capacity: 10,
    booked_count: 3,
    waiting: 0,
    event_state: "scheduled",
    day_index: null,
    day_count: null,
    ...overrides,
  });
}

test("SCH-50 the page opens on My schedule unless the tab last chose the Full studio schedule", () => {
  assert.strictEqual(parseScope(null), "mine");
  assert.strictEqual(parseScope("studio"), "studio");
  assert.strictEqual(parseScope("mine"), "mine");
  assert.strictEqual(parseScope("everything"), "mine", "anything unreadable is My schedule");
});

test("SCH-50 the Full studio schedule's Instructor and Location filters narrow it", () => {
  const all = { instructorId: "all", locationId: "all" };
  assert.strictEqual(matchesStudioFilters(entry(), all), true);
  assert.strictEqual(matchesStudioFilters(entry(), { ...all, instructorId: OTHER }), true);
  assert.strictEqual(matchesStudioFilters(entry(), { ...all, instructorId: ME }), false);
  const supported = entry({ instructor_ids: [OTHER, ME], supporting_instructor_ids: [ME] });
  assert.strictEqual(matchesStudioFilters(supported, { ...all, instructorId: ME }), true, "a class they support is theirs too");
  assert.strictEqual(matchesStudioFilters(entry(), { ...all, locationId: "loc-1" }), true);
  assert.strictEqual(matchesStudioFilters(entry(), { ...all, locationId: "loc-2" }), false);
});

test("SCH-50 on the Full studio schedule another instructor's class or private session opens nothing and offers no Cancel", () => {
  const viewer = { staffId: ME, canScheduleClasses: true };
  const theirs = myScheduleRow(entry(), viewer);
  assert.strictEqual(theirs.href, null);
  assert.strictEqual(theirs.canCancel, false);
  const theirPt = myScheduleRow(entry({ kind: "pt", id: "pt-1", main_instructor_id: null }), viewer);
  assert.strictEqual(theirPt.href, null);
  const mine = myScheduleRow(entry({ main_instructor_id: ME, instructor_ids: [ME] }), viewer);
  assert.strictEqual(mine.href, "/instructor/schedule/class/class-1", "their own still opens its page");
});
