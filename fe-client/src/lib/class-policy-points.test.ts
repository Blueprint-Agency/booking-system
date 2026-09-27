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

test("the schedule's policy notice states the window, the cap and the late rule, one per line", () => {
  assert.deepEqual(classPolicyPoints(policy()), [
    "Cancel at least 2 hours before class to get your credit back.",
    "Limit: 3 cancellations per 30 days. Go over it and the credit isn't returned, even in time.",
    "Cancel later and the credit isn't returned.",
  ]);
});

test("a daily cap reads as a day, not 1 days", () => {
  // Over the cap the cancel still goes through; only the credit is lost.
  assert.match(
    classPolicyPoints(policy({ cancel_cap_count: 1, cancel_cap_cycle_days: 1 }))[1],
    /^Limit: 1 cancellation per day\./,
  );
});

test("with the cap off, nothing is said of one", () => {
  const points = classPolicyPoints(policy({ cancel_cap_enabled: false, class_window_hours: 1 }));
  assert.deepEqual(points, [
    "Cancel at least 1 hour before class to get your credit back.",
    "Cancel later and the credit isn't returned.",
  ]);
});

test("with no window there is no late cancel to warn of", () => {
  assert.deepEqual(classPolicyPoints(policy({ cancel_cap_enabled: false }), 0), [
    "Cancel any time before class starts to get your credit back.",
  ]);
});

test("a cap of none says the credit never comes back", () => {
  assert.deepEqual(classPolicyPoints(policy({ cancel_cap_count: 0 })), [
    "Cancel any time before class starts.",
    "Cancelled credits aren't returned.",
  ]);
});
