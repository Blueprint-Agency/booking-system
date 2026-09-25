import test from "node:test";
import assert from "node:assert";
import { ApiError } from "./api";
import { capacityLine } from "./capacity";
import { seatTag, seatsSummary, staffBookingRefusal } from "./class-seats";

const CLASS = {
  capacity_online: 10,
  capacity_buffer: 6,
  attendance_capacity: 16,
  online_used: 6,
  buffer_used: 2,
  overbook_used: 0,
  attending: 8,
};

test("the session stats read people over attendance capacity, and the seats by kind", () => {
  assert.deepStrictEqual(seatsSummary(CLASS), {
    booked: "8 / 16",
    seats: "6 / 10 online · 2 / 6 buffer",
    overbooked: null,
  });
});

test("an overbooked class says how many", () => {
  assert.strictEqual(seatsSummary({ ...CLASS, overbook_used: 2, attending: 10 }).overbooked, "2 overbooked");
});

test("roster rows tag buffer and overbook seats; an online seat carries no tag", () => {
  assert.strictEqual(seatTag("online"), null);
  assert.strictEqual(seatTag("buffer"), "Buffer");
  assert.strictEqual(seatTag("overbook"), "Overbook");
});

test("a full class asks an admin whether to overbook", () => {
  const refusal = staffBookingRefusal(new ApiError(409, { error: "class_full", waitlist_open: false }), "admin");
  assert.deepStrictEqual(refusal, { kind: "full", message: "No seats left. Overbook?", canOverbook: true });
});

test("a full class tells an instructor there are no seats, with nothing to override", () => {
  const refusal = staffBookingRefusal(new ApiError(409, { error: "class_full" }), "instructor");
  assert.deepStrictEqual(refusal, { kind: "full", message: "No seats left.", canOverbook: false });
});

test("a member whose packages can't pay is explained in staff terms", () => {
  assert.deepStrictEqual(staffBookingRefusal(new ApiError(409, { error: "insufficient_credits" }), "admin"), {
    kind: "error",
    message: "This member has no package that can pay for this class.",
  });
});

test("an unknown refusal falls back to the status", () => {
  assert.deepStrictEqual(staffBookingRefusal(new ApiError(500, null), "admin"), {
    kind: "error",
    message: "Couldn't add the member (HTTP 500).",
  });
  assert.deepStrictEqual(staffBookingRefusal(new Error("offline"), "admin"), {
    kind: "error",
    message: "Network error",
  });
});

test("SCH-04 the capacity fields read attendance capacity and the waitlist apart", () => {
  assert.strictEqual(capacityLine({ waitlist: 5, onlineBooking: 10, buffer: 2 }), "Attendance capacity: 12 · Waitlist: 5");
});
