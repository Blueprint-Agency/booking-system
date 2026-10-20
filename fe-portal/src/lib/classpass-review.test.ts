import test from "node:test";
import assert from "node:assert/strict";
import {
  canBook,
  classChoices,
  classSearchWindow,
  mappedSummary,
  reviewReasonLabel,
  unmappedLocations,
  type ClassPassReviewItem,
} from "./classpass-review";
import type { ApiScheduleEntry } from "./use-schedule";

const item: ClassPassReviewItem = {
  id: "i1",
  kind: "booking",
  received_at: "2026-09-10T02:00:00Z",
  subject: "ClassPass user reservation",
  outcome: "review",
  reason: "no_class",
  reservation_id: "76ada2434e044c31b181fa605321a07f",
  class_name: "Yoga Stretch",
  location_name: "Northwind - Harbour",
  starts_at: "2026-09-18T05:30:00Z",
  member_name: "Placeholder Member",
  member_email: "member@example.test",
  text: null,
  html: "<p>…</p>",
  booking_id: null,
  resolved_at: null,
  resolved_by_staff_id: null,
};

function entry(id: string, startsAt: string, extra: Partial<ApiScheduleEntry> = {}): ApiScheduleEntry {
  return {
    kind: "class",
    id,
    workshop_id: null,
    label: "Yoga Stretch",
    subtitle: null,
    class_type_id: null,
    main_instructor_id: null,
    supporting_instructor_ids: [],
    instructor_ids: [],
    location_id: null,
    room_id: null,
    starts_at: startsAt,
    ends_at: startsAt,
    capacity: 10,
    booked_count: 0,
    event_state: "scheduled",
    day_index: null,
    day_count: null,
    series_id: null,
    ...extra,
  };
}

test("each review reason reads as words, and an unknown one as For review", () => {
  assert.equal(reviewReasonLabel("unmapped_location"), "Location not mapped");
  assert.equal(reviewReasonLabel("unparsed"), "Couldn’t read the email");
  assert.equal(reviewReasonLabel(null), "For review");
});

test("an item can be booked only when its email named the reservation and the member", () => {
  assert.equal(canBook(item), true);
  assert.equal(canBook({ ...item, reservation_id: null }), false);
  assert.equal(canBook({ ...item, member_email: null }), false);
});

test("CPS-94 an item missing only its time, class or location can be booked: the picked class gives those", () => {
  assert.equal(canBook({ ...item, reason: "unparsed", outcome: "unparsed", starts_at: null, class_name: null, location_name: null }), true);
  assert.equal(canBook({ ...item, reason: "import_off" }), true);
});

test("CPS-95 an item for a removed member, or a cancellation, offers no booking", () => {
  assert.equal(canBook({ ...item, reason: "client_deleted" }), false);
  assert.equal(canBook({ ...item, kind: "cancellation", reason: "import_off" }), false);
});

test("an item kept while the import was off, or whose placing failed, reads as words", () => {
  assert.equal(reviewReasonLabel("import_off"), "Arrived while the import was off");
  assert.equal(reviewReasonLabel("import_error"), "Couldn’t be imported");
});

test("the class picker looks a day around the email's time, or its arrival when it has none", () => {
  assert.deepEqual(classSearchWindow(item), { from: "2026-09-17T17:30:00.000Z", to: "2026-09-18T17:30:00.000Z" });
  assert.deepEqual(classSearchWindow({ ...item, starts_at: null }), {
    from: "2026-09-09T14:00:00.000Z",
    to: "2026-09-10T14:00:00.000Z",
  });
});

test("the class picker offers live classes only, nearest the email's time first", () => {
  const choices = classChoices(
    [
      entry("far", "2026-09-18T01:00:00Z"),
      entry("near", "2026-09-18T05:45:00Z"),
      entry("gone", "2026-09-18T05:30:00Z", { event_state: "cancelled" }),
      entry("pt", "2026-09-18T05:30:00Z", { kind: "pt" }),
    ],
    item,
  );
  assert.deepEqual(
    choices.map((c) => c.id),
    ["near", "far"],
  );
});

test("mapping a location from a review item says how many it imported and how many are still open", () => {
  const done = { ...item, resolved_at: "2026-09-10T03:00:00Z" };
  assert.equal(mappedSummary([done]), "Location mapped. 1 booking imported.");
  assert.equal(mappedSummary([done, done, item]), "Location mapped. 2 bookings imported, 1 still for review.");
});

test("CPS-110 the setup guide lists each unmapped ClassPass location name once, with how many items wait on it", () => {
  const unmapped = (id: string, location_name: string | null): ClassPassReviewItem => ({
    ...item,
    id,
    reason: "unmapped_location",
    location_name,
  });
  assert.deepEqual(
    unmappedLocations([
      unmapped("a", "Northwind - Harbour"),
      { ...item, id: "b" },
      unmapped("c", "northwind  -  harbour"),
      unmapped("d", "Northwind - Annex"),
      unmapped("e", null),
    ]),
    [
      { name: "Northwind - Harbour", itemId: "a", count: 2 },
      { name: "Northwind - Annex", itemId: "d", count: 1 },
    ],
  );
});
