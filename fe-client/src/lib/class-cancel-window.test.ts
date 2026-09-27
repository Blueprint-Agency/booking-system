import { test } from "node:test";
import assert from "node:assert/strict";
import { classBookingPolicy, classCancelWindowLine, type CancellationPolicy } from "./cancellation-copy.ts";

/**
 * A class may carry its own Cancellation Window (#313). Where a member books
 * one class, the sentence states that class's window; the studio-wide
 * sentence keeps the studio's.
 */

const policy: CancellationPolicy = {
  class_window_hours: 24,
  pt_window_hours: 12,
  cancel_cap_enabled: true,
  cancel_cap_count: 3,
  cancel_cap_cycle_days: 30,
};

test("the booking sentence states the class's own window when it has one", () => {
  assert.match(classBookingPolicy(policy, 6), /up to 6 hours before it starts/);
  assert.doesNotMatch(classBookingPolicy(policy, 6), /24 hours/);
  assert.match(classBookingPolicy(policy, 1), /up to 1 hour before it starts/);
  assert.match(classBookingPolicy(policy, 0), /any time before it starts/);
  // The cap is still the studio's.
  assert.match(classBookingPolicy(policy, 6), /up to 3 cancellations every 30 days/);
});

test("without a class's window the sentence is the studio's", () => {
  assert.match(classBookingPolicy(policy), /up to 24 hours before it starts/);
});

test("the class detail states that class's window on its own", () => {
  assert.equal(classCancelWindowLine(12), "Cancel up to 12 hours before it starts.");
  assert.equal(classCancelWindowLine(1), "Cancel up to 1 hour before it starts.");
  assert.equal(classCancelWindowLine(0), "Cancel any time before it starts.");
});
