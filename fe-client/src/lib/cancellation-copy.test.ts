import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cancelClosed,
  canStillCancel,
  classBookingPolicy,
  classCancelNotice,
  ptCancelPrompt,
  ptCancelResult,
  ptPolicyNote,
  windowRefusal,
  type CancellationPolicy,
} from "./cancellation-copy.ts";

const policy = (over: Partial<CancellationPolicy> = {}): CancellationPolicy => ({
  class_window_hours: 48,
  pt_window_hours: 12,
  cancel_cap_count: 3,
  cancel_cap_cycle_days: 30,
  ...over,
});

test("the cancel button follows the studio's window, not a fixed 24 hours", () => {
  const now = Date.parse("2026-09-25T00:00:00Z");
  const in30h = new Date(now + 30 * 3_600_000).toISOString();
  // 30 hours out: open under a 24h window, closed under a 48h one.
  assert.equal(canStillCancel(in30h, 24, now), true);
  assert.equal(canStillCancel(in30h, 48, now), false);
  // Exactly at the cutoff is in time — the server's `now <= cutoff`.
  assert.equal(canStillCancel(in30h, 30, now), true);
  // A zero window still closes at the start.
  assert.equal(canStillCancel(new Date(now - 1).toISOString(), 0, now), false);
});

test("the window in every sentence is the studio's", () => {
  assert.equal(cancelClosed(48), "Cancellation closed · within 48 hours of start");
  assert.equal(cancelClosed(1), "Cancellation closed · within 1 hour of start");
  assert.match(windowRefusal("session", 12), /within 12 hours/);
  assert.match(classBookingPolicy(policy()), /up to 48 hours before it starts/);
  assert.match(ptPolicyNote(policy()), /up to 12 hours before it starts/);
});

test("a credit comes back only while the member is under the cap", () => {
  const notice = classCancelNotice(policy(), false);
  assert.equal(
    notice,
    "You'll get your credit back if you haven't used up your cancellations this cycle " +
      "(3 cancellations every 30 days). Otherwise you lose the credit.",
  );
  assert.match(classBookingPolicy(policy()), /up to 3 cancellations every 30 days/);
  // A cap of nothing returns nothing, and says so instead of promising.
  assert.equal(classCancelNotice(policy({ cancel_cap_count: 0 }), false), "Cancelling doesn't return your credit.");
  assert.match(classBookingPolicy(policy({ cancel_cap_count: 0 })), /doesn't return the credit/);
});

test("an Unlimited booking frees the place and returns nothing", () => {
  const notice = classCancelNotice(policy(), true);
  assert.match(notice, /^This frees your place\./);
  assert.match(notice, /nothing to return/);
  assert.doesNotMatch(notice, /credit back/);
});

test("PT: a pending request always returns; a scheduled one follows the cap", () => {
  assert.match(ptCancelPrompt("pending", policy()), /come back to your package/);
  assert.match(ptCancelPrompt("scheduled", policy()), /session back if you haven't used up your cancellations/);
  assert.deepEqual(ptCancelResult("session_returned", 2), {
    tone: "ok",
    text: "Cancelled · 2 sessions returned to your package.",
  });
  assert.equal(ptCancelResult("forfeited", 0).tone, "warn");
  assert.match(ptCancelResult("forfeited", 0).text, /wasn't returned/);
});

test("no sentence calls a returned credit or session a refund", () => {
  const all = [
    classBookingPolicy(policy()),
    classCancelNotice(policy(), false),
    classCancelNotice(policy(), true),
    classCancelNotice(null, false),
    ptCancelPrompt("pending", policy()),
    ptCancelPrompt("scheduled", policy()),
    ptCancelPrompt("scheduled", null),
    ptPolicyNote(policy()),
    ptPolicyNote(null),
    ptCancelResult("session_returned", 1).text,
    ptCancelResult("forfeited", 0).text,
  ];
  for (const s of all) assert.doesNotMatch(s, /refund/i, s);
});
