import test from "node:test";
import assert from "node:assert";
import { myScheduleRow, type MyScheduleEntry } from "./my-schedule";

const ME = "staff-me";
const lead = { staffId: ME, canScheduleClasses: true };

function entry(overrides: Partial<MyScheduleEntry> = {}): MyScheduleEntry {
  return {
    kind: "class",
    id: "class-1",
    label: "Morning Flow",
    subtitle: null,
    main_instructor_id: ME,
    instructor_ids: [ME],
    location_id: null,
    room_id: null,
    starts_at: "2026-09-27T02:00:00.000Z",
    ends_at: "2026-09-27T03:00:00.000Z",
    capacity: 10,
    booked_count: 0,
    waiting: null,
    event_state: "scheduled",
    ...overrides,
  };
}

test("SCH-34 a cancelled class on My schedule is marked cancelled and offers no Cancel", () => {
  const row = myScheduleRow(entry({ event_state: "cancelled" }), lead);
  assert.strictEqual(row.cancelled, true);
  assert.strictEqual(row.canCancel, false);
  assert.strictEqual(row.href, "/instructor/schedule/class/class-1", "its page still shows who was booked");
});

test("SCH-34 a cancelled workshop on My schedule is marked cancelled too", () => {
  const row = myScheduleRow(entry({ kind: "workshop", id: "ws-1", event_state: "cancelled" }), lead);
  assert.strictEqual(row.cancelled, true);
  assert.strictEqual(row.canCancel, false);
});

test("SCH-34 a class still to run is not marked cancelled, and its lead may cancel it", () => {
  const row = myScheduleRow(entry(), lead);
  assert.strictEqual(row.cancelled, false);
  assert.strictEqual(row.canCancel, true);
});

test("Cancel is offered only on a class the instructor leads, still to finish, with Schedule classes on", () => {
  assert.strictEqual(myScheduleRow(entry({ event_state: "completed" }), lead).canCancel, false);
  assert.strictEqual(myScheduleRow(entry({ main_instructor_id: "staff-other" }), lead).canCancel, false);
  assert.strictEqual(myScheduleRow(entry(), { staffId: ME, canScheduleClasses: false }).canCancel, false);
  assert.strictEqual(myScheduleRow(entry({ kind: "pt", main_instructor_id: null }), lead).canCancel, false);
});

test("a class someone else leads opens no page from My schedule", () => {
  assert.strictEqual(myScheduleRow(entry({ main_instructor_id: "staff-other" }), lead).href, null);
});
