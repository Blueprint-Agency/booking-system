import { test } from "node:test";
import assert from "node:assert/strict";
import { classPolicyPoints, type CancellationPolicy } from "./cancellation-copy.ts";

const policy = (over: Partial<CancellationPolicy> = {}): CancellationPolicy => ({
  class_window_hours: 2,
  pt_window_hours: 12,
  cancel_cap_enabled: true,
  cancel_cap_count: 3,
  cancel_cap_cycle_days: 30,
  ...over,
});

test("the schedule's policy notice states the window, the late rule and the cap, one per line", () => {
  assert.deepEqual(classPolicyPoints(policy()), [
    "Cancel at least 2 hours before class and you get your credit back.",
    "Cancel within 2 hours of class and you lose the credit.",
    "You get 3 cancellations every 30 days. After that, you lose the credit even if you cancel early.",
  ]);
});

test("a daily cap reads as a day, not 1 days", () => {
  // Over the cap the cancel still goes through; only the credit is lost.
  assert.match(
    classPolicyPoints(policy({ cancel_cap_count: 1, cancel_cap_cycle_days: 1 }))[2],
    /^You get 1 cancellation a day\./,
  );
});

test("with the cap off, nothing is said of one", () => {
  const points = classPolicyPoints(policy({ cancel_cap_enabled: false, class_window_hours: 1 }));
  assert.deepEqual(points, [
    "Cancel at least 1 hour before class and you get your credit back.",
    "Cancel within 1 hour of class and you lose the credit.",
  ]);
});

test("with no window there is no late cancel to warn of", () => {
  assert.deepEqual(classPolicyPoints(policy({ cancel_cap_enabled: false }), 0), [
    "Cancel any time before class starts and you get your credit back.",
  ]);
});

test("a cap of none says the credit never comes back", () => {
  assert.deepEqual(classPolicyPoints(policy({ cancel_cap_count: 0 })), [
    "You can cancel any time before class starts.",
    "You won't get your credit back.",
  ]);
});
