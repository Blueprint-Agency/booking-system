import test from "node:test";
import assert from "node:assert";
import {
  ptBookingWindowProblem,
  ptNoteOrNull,
  ptOffProposal,
  ptRequestSummary,
  type ApiPtRequest,
} from "./pt-requests";

const req = (over: Partial<ApiPtRequest>): ApiPtRequest => ({
  id: "r1",
  status: "scheduled",
  session_type: "2on1",
  message: "Mornings please",
  schedule_note: null,
  cancel_note: null,
  origin: "member",
  created_at: "2031-04-01T00:00:00.000Z",
  expires_at: "2031-04-08T00:00:00.000Z",
  resolved_at: null,
  refund_outcome: null,
  client: { id: "c1", name: "Sam", email: "sam@example.test" },
  class_type: { id: "t1", name: "Mobility" },
  location: { id: "l1", name: "Studio" },
  co_client: { clientId: null, name: "Kim", email: "kim@example.test" },
  bound_instructor: { id: "i1", name: "Ana" },
  slots: [
    { proposed_date: "2031-04-02", start_time: "09:00:00", end_time: null },
    { proposed_date: "2031-04-03", start_time: "10:00:00", end_time: null },
  ],
  session: null,
  ...over,
});

test("PT-110 a member's request lists its type, class type, first proposed slot and partner", () => {
  assert.strictEqual(
    ptRequestSummary(req({})),
    "2ON1 · Mobility · 2031-04-02 09:00 +1 more · partner: needs account · with Ana",
  );
});

test("PT-110 a manual session is marked Manual, with no proposed slot, class type or partner hint", () => {
  const manual = req({
    origin: "portal",
    message: null,
    expires_at: null,
    class_type: null,
    slots: [],
    bound_instructor: null,
    co_client: { clientId: "c2", name: "Kim", email: "kim@example.test" },
    session: {
      id: "s1",
      starts_at: "2031-04-02T01:00:00.000Z",
      ends_at: "2031-04-02T02:00:00.000Z",
      instructor_name: "Ana",
      room_name: "Room 1",
    },
  });
  assert.strictEqual(ptRequestSummary(manual), "2ON1 · Manual · partner: Kim · Ana · Room 1");
});

test("PT-121 a time on none of the member's proposals offers a note; one of them, or a request with none, does not", () => {
  const slots = [
    { proposed_date: "2031-04-03", start_time: "09:00:00", end_time: null },
    { proposed_date: "2031-04-04", start_time: "18:30:00", end_time: null },
  ];
  // A start-only proposal leaves the length to the studio: any end is on it.
  assert.strictEqual(ptOffProposal(slots, "2031-04-03", "09:00", "10:00"), false);
  assert.strictEqual(ptOffProposal(slots, "2031-04-04", "18:30", "20:00"), false);
  assert.strictEqual(ptOffProposal(slots, "2031-04-03", "10:00", "11:00"), true, "another time that day");
  assert.strictEqual(ptOffProposal(slots, "2031-04-05", "09:00", "10:00"), true, "a proposed time on another day");
  assert.strictEqual(ptOffProposal([], "2031-04-05", "09:00", "10:00"), false, "a manual session proposed nothing");
});

test("PT-121 on an older request that proposed an end, a different end is off the proposal", () => {
  const slots = [{ proposed_date: "2031-04-03", start_time: "09:00:00", end_time: "10:00:00" }];
  assert.strictEqual(ptOffProposal(slots, "2031-04-03", "09:00", "10:00"), false);
  assert.strictEqual(ptOffProposal(slots, "2031-04-03", "09:00", "11:00"), true);
});

test("PT-120 a Book in advance window is saved only with a minimum no later than the maximum, in whole days", () => {
  assert.strictEqual(ptBookingWindowProblem(3, 7), null);
  assert.strictEqual(ptBookingWindowProblem(7, 7), null);
  assert.match(ptBookingWindowProblem(8, 7) ?? "", /minimum/);
  assert.match(ptBookingWindowProblem(0, 7) ?? "", /whole days/);
  assert.match(ptBookingWindowProblem(3, 1.5) ?? "", /whole days/);
  assert.match(ptBookingWindowProblem(3, Number.NaN) ?? "", /whole days/);
});

test("PT-121 a note of only spaces is no note", () => {
  assert.strictEqual(ptNoteOrNull("  Coach is away.  "), "Coach is away.");
  assert.strictEqual(ptNoteOrNull("   "), null);
});
