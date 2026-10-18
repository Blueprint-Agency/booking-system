import test from "node:test";
import assert from "node:assert/strict";
import { mappableLocations, outcomeRows, overbookedHeadline } from "./classpass";

test("CPS-28 the mapping editor offers the studio's live Locations by name, never an archived one", () => {
  const offered = mappableLocations([
    { id: "b", name: "Harbour", archivedAt: null },
    { id: "a", name: "Annex", archivedAt: "2026-01-01T00:00:00Z" },
    { id: "c", name: "Bay", archivedAt: null },
  ]);
  assert.deepEqual(offered, [
    { id: "c", name: "Bay" },
    { id: "b", name: "Harbour" },
  ]);
});

test("the import status lists every outcome, a missing one as 0, and totals them", () => {
  const { rows, total } = outcomeRows({ ignored: 4, refused: 1 });
  assert.equal(rows.length, 7);
  assert.equal(rows.find((r) => r.outcome === "ignored")?.count, 4);
  assert.equal(rows.find((r) => r.outcome === "refused")?.count, 1);
  assert.equal(rows.find((r) => r.outcome === "imported")?.count, 0);
  assert.equal(total, 5);
});

test("CPS-36 the ClassPass page flags ClassPass bookings that took an Overbook seat, counting them", () => {
  const one = {
    booking_id: "b1",
    class_id: "c1",
    class_name: "Yoga Stretch",
    starts_at: "2026-09-18T05:30:00Z",
    client_name: "Placeholder Member",
  };
  assert.equal(overbookedHeadline([one]), "1 ClassPass booking took an Overbook seat on an upcoming class.");
  assert.equal(
    overbookedHeadline([one, { ...one, booking_id: "b2" }]),
    "2 ClassPass bookings took an Overbook seat on upcoming classes.",
  );
});
