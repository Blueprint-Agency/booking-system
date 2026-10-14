import { test } from "node:test";
import assert from "node:assert/strict";
import { classBookingPolicy, classCancelWindowLine, type CancellationPolicy } from "./cancellation-copy.ts";

/**
 * Every class is judged by the studio's one class window, as Global Policy
 * sets it. Where a member books, the sentence states that window.
 */

const policy = (class_window_hours: number): CancellationPolicy => ({
  class_window_hours,
  pt_window_hours: 12,
  cancel_cap_enabled: true,
  cancel_cap_count: 3,
  cancel_cap_cycle_days: 30,
});

test("the booking sentence states the studio's class window", () => {
  assert.match(classBookingPolicy(policy(6)), /up to 6 hours before it starts/);
  assert.doesNotMatch(classBookingPolicy(policy(6)), /24 hours/);
  assert.match(classBookingPolicy(policy(1)), /up to 1 hour before it starts/);
  assert.match(classBookingPolicy(policy(0)), /any time before it starts/);
  assert.match(classBookingPolicy(policy(6)), /up to 3 cancellations every 30 days/);
});

test("the class detail states the window on its own", () => {
  assert.equal(classCancelWindowLine(12), "Cancel up to 12 hours before it starts.");
  assert.equal(classCancelWindowLine(1), "Cancel up to 1 hour before it starts.");
  assert.equal(classCancelWindowLine(0), "Cancel any time before it starts.");
});
