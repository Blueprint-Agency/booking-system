import test from "node:test";
import assert from "node:assert";
import { myCalendarHref, myScheduleRow } from "./my-schedule";
import { scheduleEntryFromApi, type ApiScheduleEntry } from "./schedule-entry";

const ME = "staff-me";
const lead = { staffId: ME, canScheduleClasses: true };

/** An entry on My schedule's List, as the Instructor's `GET /schedule` sends it. */
function entry(overrides: Partial<ApiScheduleEntry> = {}) {
  return onCalendar({ starts_at: "2026-09-27T02:00:00.000Z", ends_at: "2026-09-27T03:00:00.000Z", ...overrides });
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

/** An entry as the Instructor's `GET /schedule` sends it, through the calendar's mapping. */
function onCalendar(overrides: Partial<ApiScheduleEntry> = {}) {
  return scheduleEntryFromApi({
    kind: "class",
    id: "class-1",
    workshop_id: null,
    label: "Morning Flow",
    subtitle: null,
    class_type_id: "ct-1",
    main_instructor_id: ME,
    supporting_instructor_ids: [],
    instructor_ids: [ME],
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

test("SCH-47 on My schedule's calendar, a class the Instructor leads and a private session they run open their pages", () => {
  assert.strictEqual(myCalendarHref(onCalendar(), ME), "/instructor/schedule/class/class-1");
  assert.strictEqual(
    myCalendarHref(onCalendar({ kind: "pt", id: "pt-1", main_instructor_id: null }), ME),
    "/instructor/schedule/pt/pt-1",
  );
});

test("SCH-47 a class they support, a workshop or a corporate session shows on the calendar and opens no page", () => {
  const supported = onCalendar({ main_instructor_id: "staff-other", instructor_ids: ["staff-other", ME] });
  assert.strictEqual(myCalendarHref(supported, ME), null);
  const workshop = onCalendar({ kind: "workshop", id: "day-1", workshop_id: "ws-1", class_type_id: null, day_index: 1, day_count: 2 });
  assert.strictEqual(myCalendarHref(workshop, ME), null);
  assert.strictEqual(myCalendarHref(onCalendar({ kind: "corporate", id: "corp-1" }), ME), null);
  // Signed-in staff not yet known: nothing opens.
  assert.strictEqual(myCalendarHref(onCalendar(), null), null);
});
