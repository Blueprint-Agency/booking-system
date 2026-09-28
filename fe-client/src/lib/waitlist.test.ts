import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classAction,
  joinedToast,
  waitlistRefusal,
  type ClassActionInput,
} from "./waitlist.ts";

const row = (over: Partial<ClassActionInput> = {}): ClassActionInput => ({
  booked: false,
  myEntry: null,
  hasSeats: false,
  waitlistOpen: false,
  notCovered: false,
  ...over,
});

test("a booked class shows Booked and no waitlist control, whatever the line says", () => {
  assert.equal(classAction(row({ booked: true, waitlistOpen: true })), "booked");
  assert.equal(classAction(row({ booked: true, myEntry: { id: "e", position: 1 } })), "booked");
});

test("a member in line sees their place before anything else", () => {
  assert.equal(classAction(row({ myEntry: { id: "e", position: 2 }, waitlistOpen: true })), "waitlisted");
  assert.equal(classAction(row({ myEntry: { id: "e", position: 2 }, waitlistOpen: false })), "waitlisted");
});

test("a free seat is booked, not queued for", () => {
  assert.equal(classAction(row({ hasSeats: true, waitlistOpen: true })), "book");
  assert.equal(classAction(row({ hasSeats: true, notCovered: true })), "not_covered");
});

test("a full class with an open line offers the waitlist; otherwise it is Full", () => {
  assert.equal(classAction(row({ hasSeats: false, waitlistOpen: true })), "join_waitlist");
  assert.equal(classAction(row({ hasSeats: false, waitlistOpen: false })), "full");
});

test("a class that takes none of the member's packages offers neither a seat nor the line", () => {
  assert.equal(classAction(row({ hasSeats: true, notAccepted: true })), "not_accepted");
  assert.equal(classAction(row({ hasSeats: true, notAccepted: true, notCovered: true })), "not_accepted");
  assert.equal(classAction(row({ hasSeats: false, waitlistOpen: true, notAccepted: true })), "not_accepted");
  // Full is full, whatever the rule; and the member's own booking or place still shows.
  assert.equal(classAction(row({ hasSeats: false, waitlistOpen: false, notAccepted: true })), "full");
  assert.equal(classAction(row({ booked: true, notAccepted: true })), "booked");
  assert.equal(classAction(row({ myEntry: { id: "e", position: 1 }, notAccepted: true })), "waitlisted");
});

test("BKG-42 a class overlapping the member's booking reads as the clash, instead of Book or Join waitlist", () => {
  assert.equal(classAction(row({ hasSeats: true, clash: true })), "clash");
  assert.equal(classAction(row({ hasSeats: false, waitlistOpen: true, clash: true })), "clash");
  // Full with no line is Full; the member's own booking or place still shows first.
  assert.equal(classAction(row({ hasSeats: false, waitlistOpen: false, clash: true })), "full");
  assert.equal(classAction(row({ booked: true, clash: true })), "booked");
  assert.equal(classAction(row({ myEntry: { id: "e", position: 1 }, clash: true })), "waitlisted");
  // No clash, the row reads as before.
  assert.equal(classAction(row({ hasSeats: true, clash: false })), "book");
});

test("the join toast names the member's place", () => {
  assert.equal(
    joinedToast(3),
    "Class is full — you're #3 on the waitlist. We'll book you in and email you if a seat opens.",
  );
});

test("a closed waitlist says how many hours before the class it closes", () => {
  assert.deepEqual(waitlistRefusal("waitlist_closed", { error: "waitlist_closed", window_hours: 12 }), {
    kind: "message",
    msg: "This class starts within 12 hours, so the waitlist has closed.",
    closed: true,
  });
  assert.deepEqual(waitlistRefusal("waitlist_closed", { error: "waitlist_closed", window_hours: 1 }), {
    kind: "message",
    msg: "This class starts within 1 hour, so the waitlist has closed.",
    closed: true,
  });
});

test("a full line says so and closes the row", () => {
  assert.deepEqual(waitlistRefusal("waitlist_full", {}), {
    kind: "message",
    msg: "The waitlist for this class is full.",
    closed: true,
  });
});

test("already in line or already booked re-reads the row instead of explaining", () => {
  assert.deepEqual(waitlistRefusal("already_waitlisted", {}), { kind: "refresh" });
  assert.deepEqual(waitlistRefusal("already_booked", {}), { kind: "refresh" });
});

test("no package that can pay opens the same dialog booking does", () => {
  assert.deepEqual(waitlistRefusal("insufficient_credits", {}), { kind: "no_package" });
});

test("the package-selection refusals read as they do when booking", () => {
  assert.deepEqual(waitlistRefusal("location_not_covered", {}, "Studio East"), {
    kind: "message",
    msg: "Your plan covers Studio East only.",
  });
  assert.deepEqual(waitlistRefusal("location_not_covered", {}, null), {
    kind: "message",
    msg: "Your plan doesn't cover this studio.",
  });
  assert.deepEqual(waitlistRefusal("plan_expires_before_class", {}), {
    kind: "message",
    msg: "Your current package runs out before this class starts, so it can't cover it.",
  });
  // Several packages may run at once, so nothing tells the member to wait for one to end.
  const runsOut = waitlistRefusal("plan_expires_before_class", {});
  assert.ok(runsOut && runsOut.kind === "message");
  assert.doesNotMatch(runsOut.msg, /once it has ended|next package/);
});

test("a join the class's package rule refuses says so and stops the row offering the line", () => {
  assert.deepEqual(waitlistRefusal("not_accepted", {}), {
    kind: "message",
    msg: "Your package isn't accepted for this class. Tap the class to see which packages are.",
    notAccepted: true,
  });
});

test("every other waitlist code has member copy", () => {
  for (const code of ["waitlist_disabled", "class_not_full", "class_not_found", "waitlist_entry_not_found"]) {
    const out = waitlistRefusal(code, {});
    assert.ok(out, code);
    assert.notEqual(out.kind, "refresh", code);
  }
  assert.deepEqual(waitlistRefusal("class_not_full", {}), {
    kind: "message",
    msg: "A spot just opened in this class — you can book it now.",
    refresh: true,
  });
});

test("an unknown code falls back to the caller's generic message", () => {
  assert.equal(waitlistRefusal("something_new", {}), null);
  assert.equal(waitlistRefusal("", null), null);
});
