import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LATE_CANCEL_LINE,
  canCancelClass,
  cancelDeadlineLine,
  classBookingPolicy,
  classCancelNotice,
  classCancelResult,
  isLate,
  ptCancelPrompt,
  ptPolicyNote,
  type CancelPreview,
  type CancellationPolicy,
} from "./cancellation-copy.ts";

/**
 * Late cancellation and the Cancellation Cap switch (#318): a member can
 * cancel a class until it starts; inside its window the cancel is late and the
 * credit stays spent; with the cap off every cancel in time returns, and
 * nothing mentions a cap.
 */

const policy = (over: Partial<CancellationPolicy> = {}): CancellationPolicy => ({
  class_window_hours: 24,
  pt_window_hours: 24,
  cancel_cap_enabled: true,
  cancel_cap_count: 10,
  cancel_cap_cycle_days: 30,
  ...over,
});

const preview = (over: Partial<CancelPreview> = {}): CancelPreview => ({
  late: false,
  credit_back: true,
  credits: 1,
  unlimited: false,
  ...over,
});

const capOff = policy({ cancel_cap_enabled: false });

test("CXL-39 a class can be cancelled until it starts, and past its deadline the cancel is late", () => {
  const now = Date.parse("2026-09-25T10:00:00Z");
  assert.equal(canCancelClass(new Date(now + 60_000).toISOString(), now), true);
  assert.equal(canCancelClass(new Date(now).toISOString(), now), false, "at the start it is too late");
  assert.equal(isLate(new Date(now - 1).toISOString(), now), true);
  // Exactly at the deadline is in time — the server's `now <= cutoff`.
  assert.equal(isLate(new Date(now).toISOString(), now), false);
});

test("CXL-39 the dialog warns before a late cancel, and says what a late cancel cost after it", () => {
  assert.equal(classCancelNotice(policy(), false, preview({ late: true, credit_back: false })), LATE_CANCEL_LINE);
  assert.equal(LATE_CANCEL_LINE, "This is a late cancellation — your credit won't be returned.");
  assert.equal(
    classCancelResult("forfeited", 1, true).text,
    "Booking cancelled · a late cancellation, so the credit wasn't returned.",
  );
  assert.match(classCancelResult("forfeited", 1, false).text, /used up your cancellations/);
  assert.equal(classCancelResult("credit_returned", 2, false).text, "Booking cancelled · 2 credits returned.");
});

test("CXL-43 the dialog says what the preview says: back, over the cap, or an Unlimited late cancel", () => {
  assert.equal(
    classCancelNotice(policy(), false, preview()),
    "You'll get your 1 credit back. It counts toward your 10 cancellations every 30 days.",
  );
  assert.equal(
    classCancelNotice(policy(), false, preview({ credit_back: false })),
    "You've used up your cancellations this cycle (10 cancellations every 30 days), so your credit won't be returned.",
  );
  const unlimited = classCancelNotice(policy(), true, preview({ late: true, credit_back: false, credits: 0, unlimited: true }));
  assert.match(unlimited, /^This is a late cancellation\. This frees your place\./);
  assert.doesNotMatch(unlimited, /credit won't be returned/);
});

test("CXL-42 with the cap off nothing mentions a cap", () => {
  const sentences = [
    classBookingPolicy(capOff),
    classBookingPolicy(capOff, 6),
    classCancelNotice(capOff, false, preview()),
    classCancelNotice(capOff, true, preview({ credits: 0, unlimited: true, credit_back: false })),
    classCancelNotice(capOff, false),
    ptCancelPrompt("scheduled", capOff),
    ptPolicyNote(capOff),
  ];
  for (const s of sentences) assert.doesNotMatch(s, /cancellations? every|used up|this cycle/, s);
  assert.equal(classCancelNotice(capOff, false, preview()), "You'll get your 1 credit back.");
  assert.match(classBookingPolicy(capOff), /^Cancel a class up to 24 hours before it starts and your credit comes back\./);
});

test("CXL-39 the booking sentence says a later cancel is allowed but late", () => {
  assert.match(classBookingPolicy(policy()), /late cancellation: allowed until the class starts, but the credit isn't returned/);
  // With no window every cancel before the start is in time: there is no "later".
  assert.doesNotMatch(classBookingPolicy(policy(), 0), /late/);
});

test("CXL-43 an upcoming booking says until when a cancel is in time", () => {
  assert.equal(cancelDeadlineLine(false, "Tue 3 Oct · 6:00 PM"), "Cancel by Tue 3 Oct · 6:00 PM to avoid a late cancellation.");
  assert.equal(cancelDeadlineLine(true, "Tue 3 Oct · 6:00 PM"), "Cancelling now is a late cancellation.");
});
