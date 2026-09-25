import test from "node:test";
import assert from "node:assert";
import { ApiError } from "./api";
import {
  addToClassRefusal,
  paymentStatusLine,
  staffBookingPrompt,
  staffJoinRefusal,
  waitingTag,
  waitlistFieldLabel,
  waitlistStat,
} from "./class-waitlist";
import { FEATURE_FLAGS } from "./feature-flags";

test("WTL-17 a waiting member who could pay names the package that would", () => {
  assert.strictEqual(
    paymentStatusLine({ status: "pending", package_name: "10-Class Pack" }),
    "Pending: 10-Class Pack",
  );
});

test("WTL-17 a waiting member who can't pay says why, in staff terms", () => {
  assert.strictEqual(
    paymentStatusLine({ status: "cannot_pay", reason: "insufficient_credits" }),
    "Can't pay: no package with enough credits",
  );
  assert.strictEqual(
    paymentStatusLine({ status: "cannot_pay", reason: "location_not_covered" }),
    "Can't pay: their plan doesn't cover this studio",
  );
  assert.strictEqual(
    paymentStatusLine({ status: "cannot_pay", reason: "plan_expires_before_class" }),
    "Can't pay: their plan ends before the class",
  );
});

test("the Waitlist stat reads waiting over the line's length", () => {
  assert.strictEqual(waitlistStat({ waiting: 3, capacity_waitlist: 5 }), "3 / 5");
});

test("WTL-24 a timetable cell says how many are waiting, and nothing when nobody is", () => {
  assert.strictEqual(waitingTag(2), "+2 waiting");
  assert.strictEqual(waitingTag(0), null);
  assert.strictEqual(waitingTag(null), null);
  assert.strictEqual(waitingTag(undefined), null);
});

test("WTL-22 a full class with an open line asks an admin to overbook or add to the waitlist", () => {
  const prompt = staffBookingPrompt(
    new ApiError(409, { error: "class_full", waitlist_open: true, waiting: 1, capacity_waitlist: 5 }),
    "admin",
  );
  assert.deepStrictEqual(prompt, {
    kind: "full",
    message: "No seats left. Overbook, or add to the waitlist?",
    canOverbook: true,
    canWaitlist: true,
  });
});

test("WTL-22 an instructor is offered the waitlist and no overbook", () => {
  const prompt = staffBookingPrompt(new ApiError(409, { error: "class_full", waitlist_open: true }), "instructor");
  assert.deepStrictEqual(prompt, {
    kind: "full",
    message: "No seats left. Add to the waitlist?",
    canOverbook: false,
    canWaitlist: true,
  });
});

test("a full class whose line is closed offers no waitlist", () => {
  assert.deepStrictEqual(
    staffBookingPrompt(new ApiError(409, { error: "class_full", waitlist_open: false }), "admin"),
    { kind: "full", message: "No seats left. Overbook?", canOverbook: true, canWaitlist: false },
  );
  assert.deepStrictEqual(
    staffBookingPrompt(new ApiError(409, { error: "class_full", waitlist_open: false }), "instructor"),
    { kind: "full", message: "No seats left.", canOverbook: false, canWaitlist: false },
  );
});

test("any other booking refusal is passed through as an error", () => {
  assert.deepStrictEqual(staffBookingPrompt(new ApiError(409, { error: "already_booked" }), "admin"), {
    kind: "error",
    message: "This member is already booked on this class.",
  });
});

test("WTL-22 a refused Add to waitlist says why", () => {
  assert.strictEqual(
    staffJoinRefusal(new ApiError(409, { error: "waitlist_full" })),
    "The waitlist for this class is full.",
  );
  assert.strictEqual(
    staffJoinRefusal(new ApiError(409, { error: "waitlist_closed", window_hours: 24 })),
    "This class starts within 24 hours, so the waitlist has closed.",
  );
  assert.strictEqual(
    staffJoinRefusal(new ApiError(409, { error: "already_waitlisted" })),
    "This member is already on the waitlist.",
  );
  assert.strictEqual(
    staffJoinRefusal(new ApiError(409, { error: "insufficient_credits" })),
    "This member has no package that can pay for this class.",
  );
  assert.strictEqual(staffJoinRefusal(new ApiError(500, null)), "Couldn't add the member to the waitlist (HTTP 500).");
});

test("WTL-18 Add to class for a member who can't pay shows the selection reason on the row", () => {
  assert.deepStrictEqual(addToClassRefusal(new ApiError(409, { error: "insufficient_credits" }), "admin"), {
    kind: "error",
    message: "This member has no package that can pay for this class.",
  });
});

test("WTL-19 Add to class into a full room asks an admin to overbook, and tells an instructor no", () => {
  assert.deepStrictEqual(addToClassRefusal(new ApiError(409, { error: "class_full" }), "admin"), {
    kind: "full",
    message: "No seats left. Overbook?",
    canOverbook: true,
  });
  assert.deepStrictEqual(addToClassRefusal(new ApiError(409, { error: "class_full" }), "instructor"), {
    kind: "error",
    message: "No seats left.",
  });
});

test("a waitlist row that has already gone reads so", () => {
  assert.deepStrictEqual(addToClassRefusal(new ApiError(404, { error: "waitlist_entry_not_found" }), "admin"), {
    kind: "error",
    message: "This member is no longer on the waitlist.",
  });
});

test("WTL-23 the capacity form's Waitlist field says when the studio has waitlists off", () => {
  assert.strictEqual(waitlistFieldLabel(true), "Waitlist");
  assert.strictEqual(waitlistFieldLabel(false), "Waitlist (waitlists are off)");
  assert.strictEqual(waitlistFieldLabel(undefined), "Waitlist", "unknown yet reads as the plain label");
});

test("the feature-flags screen lists the waitlist switch with a one-line description", () => {
  const flag = FEATURE_FLAGS.find((f) => f.key === "waitlist_enabled");
  assert.ok(flag, "waitlist_enabled is on the screen");
  assert.ok(flag.description.length > 0 && !flag.description.includes("\n"));
});
