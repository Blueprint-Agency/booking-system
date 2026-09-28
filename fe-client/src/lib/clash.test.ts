import { test } from "node:test";
import assert from "node:assert/strict";
import { clashButton, clashFromBody, clashNote, clashRefusal, type ApiClash } from "./clash.ts";

// 08:00 UTC is 4:00 pm in Singapore.
const inversion: ApiClash = {
  booking_id: "b1",
  kind: "class",
  title: "Inversion",
  starts_at: "2026-09-30T08:00:00.000Z",
  ends_at: "2026-09-30T09:00:00.000Z",
  location_name: "Riverside",
};

test("BKG-42 a class that overlaps the member's booking reads as a clash, with that booking's time", () => {
  assert.equal(clashButton(inversion), "Clashes · 4:00 pm");
  assert.equal(
    clashNote(inversion),
    "You're booked into Inversion at 4:00 pm (Riverside), which overlaps this class. Cancel that booking to book this one.",
  );
  assert.equal(
    clashNote({ ...inversion, location_name: null }),
    "You're booked into Inversion at 4:00 pm, which overlaps this class. Cancel that booking to book this one.",
  );
});

test("BKG-37 a booking refused time_clash names what the member already holds", () => {
  assert.equal(
    clashRefusal(inversion),
    "You're already booked into Inversion at 4:00 pm (Riverside) at the same time. You can only be in one class at a time.",
  );
  assert.equal(
    clashRefusal(null),
    "You're already booked into another class at the same time. You can only be in one class at a time.",
  );
});

test("the clash is read from a refusal's body, and nothing else passes for one", () => {
  assert.deepEqual(clashFromBody({ error: "time_clash", clash: inversion }), inversion);
  assert.equal(clashFromBody({ error: "time_clash" }), null);
  assert.equal(clashFromBody({ clash: { title: "x" } }), null);
  assert.equal(clashFromBody(null), null);
});
