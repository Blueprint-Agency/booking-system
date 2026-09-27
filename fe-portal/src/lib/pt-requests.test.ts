import test from "node:test";
import assert from "node:assert";
import { ptRequestSummary, type ApiPtRequest } from "./pt-requests";

const req = (over: Partial<ApiPtRequest>): ApiPtRequest => ({
  id: "r1",
  status: "scheduled",
  session_type: "2on1",
  message: "Mornings please",
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
