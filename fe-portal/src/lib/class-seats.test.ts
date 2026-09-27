import test from "node:test";
import assert from "node:assert";
import { ApiError } from "./api";
import { capacityLine } from "./capacity";
import {
  packagePick,
  seatTag,
  seatsSummary,
  staffBookingRefusal,
  type StaffMemberPackage,
} from "./class-seats";

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

/* ── staff pick the member's package (#333) ── */

const pkg = (over: Partial<StaffMemberPackage>): StaffMemberPackage => ({
  id: "p",
  name: "10 Class Pass",
  kind: "credit_bundle",
  running: true,
  remaining: 4,
  expires_at: "2031-05-01T00:00:00.000Z",
  activation_end_if_picked: null,
  location: null,
  eligible: true,
  reason: null,
  ...over,
});

test("BKG-36 one or no Eligible package books straight away, with no select", () => {
  const one = pkg({ id: "a" });
  const short = pkg({ id: "b", eligible: false, reason: "insufficient_credits" });
  assert.strictEqual(packagePick({ default_client_package_id: "a", packages: [one, short] }), null);
  assert.strictEqual(packagePick({ default_client_package_id: null, packages: [short] }), null);
  assert.strictEqual(packagePick({ default_client_package_id: null, packages: [] }), null);
});

test("BKG-36 more than one Eligible package offers a select, the Default payer chosen and Ineligible ones greyed with their reason", () => {
  const pick = packagePick({
    default_client_package_id: "run",
    packages: [
      pkg({ id: "away", kind: "unlimited", remaining: null, eligible: false, reason: "location_not_covered", location: { id: "l", name: "Harbour" } }),
      pkg({ id: "run" }),
      pkg({ id: "plan", name: "Monthly Unlimited", kind: "unlimited", remaining: null, running: false, expires_at: null, activation_end_if_picked: "2031-05-10T04:00:00.000Z" }),
      pkg({ id: "short", remaining: 1, running: false, expires_at: null, eligible: false, reason: "insufficient_credits" }),
      pkg({ id: "rule", eligible: false, reason: "not_accepted" }),
      pkg({ id: "late", eligible: false, reason: "plan_expires_before_class" }),
    ],
  });
  assert.ok(pick);
  assert.strictEqual(pick.defaultId, "run");
  assert.deepStrictEqual(
    pick.options.map((o) => [o.id, o.disabled, o.note]),
    [
      ["away", true, "Covers Harbour only"],
      ["run", false, null],
      ["plan", false, "Starts today, runs until 10 May 2031"],
      ["short", true, "Not enough credits"],
      ["rule", true, "Not accepted for this class"],
      ["late", true, "Ends before this class"],
    ],
  );
  assert.strictEqual(pick.options[1]!.label, "10 Class Pass · 4 credits left");
  assert.strictEqual(pick.options[2]!.label, "Monthly Unlimited · Unlimited");
});

test("SCH-04 the capacity fields read attendance capacity and the waitlist apart", () => {
  assert.strictEqual(capacityLine({ waitlist: 5, onlineBooking: 10, buffer: 2 }), "Attendance capacity: 12 · Waitlist: 5");
});
