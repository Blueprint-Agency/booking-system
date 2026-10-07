import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cancelClosed,
  cancelledStanding,
  cancelledWhen,
  canStillCancel,
  classBookingPolicy,
  classCancelledOutcome,
  classCancelNotice,
  ptCancelPrompt,
  ptCancelResult,
  ptPolicyNote,
  windowRefusal,
  type CancellationPolicy,
  type CancelledClass,
} from "./cancellation-copy.ts";

const policy = (over: Partial<CancellationPolicy> = {}): CancellationPolicy => ({
  class_window_hours: 48,
  pt_window_hours: 12,
  cancel_cap_enabled: true,
  cancel_cap_count: 3,
  cancel_cap_cycle_days: 30,
  ...over,
});

test("a PT session's cancel button follows the studio's window, not a fixed 24 hours", () => {
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
  // Only a PT session closes to cancelling at its window; a class stays open
  // until it starts (#318, late-cancel-copy.test.ts).
  assert.equal(cancelClosed(48), "Cancellation closed · within 48 hours of start");
  assert.equal(cancelClosed(1), "Cancellation closed · within 1 hour of start");
  assert.match(windowRefusal("session", 12), /within 12 hours/);
  assert.match(classBookingPolicy(policy()), /up to 48 hours before it starts/);
  assert.match(ptPolicyNote(policy()), /up to 12 hours before it starts/);
});

test("a credit comes back only while the member is under the cap", () => {
  // Without the booking's own preview the dialog states the whole rule.
  const notice = classCancelNotice(policy(), false);
  assert.equal(
    notice,
    "Cancel a class up to 48 hours before it starts and your credit comes back, for up to " +
      "3 cancellations every 30 days; after that, cancelling doesn't return it. Cancelling later " +
      "is a late cancellation: allowed until the class starts, but the credit isn't returned.",
  );
  assert.match(classBookingPolicy(policy()), /up to 3 cancellations every 30 days/);
  assert.match(
    ptCancelPrompt("scheduled", policy()),
    /session back if you haven't used up your cancellations this cycle \(3 cancellations every 30 days\)\. Otherwise you lose the session\./,
  );
  // A cap of nothing returns nothing, and says so instead of promising.
  assert.equal(
    classCancelNotice(policy({ cancel_cap_count: 0 }), false),
    "You can cancel a class any time before it starts. Cancelling doesn't return the credit.",
  );
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

// ── The Cancelled tab (#349) ────────────────────────────────────────────────

const cancelled = (over: Partial<CancelledClass> = {}): CancelledClass => ({
  cancelled_by: "member",
  late: false,
  outcome: "credit_returned",
  credits_used: 1,
  ...over,
});

test("ACC-33 a cancelled class's outcome line says where the credit went", () => {
  assert.equal(classCancelledOutcome(cancelled({ late: true, outcome: "credit_kept_late" })), "Late cancel · credit kept");
  assert.equal(classCancelledOutcome(cancelled()), "Credit returned");
  assert.equal(classCancelledOutcome(cancelled({ credits_used: 2 })), "2 credits returned");
  assert.equal(
    classCancelledOutcome(cancelled({ outcome: "credit_kept_over_cap" })),
    "Cancelled over your cap · credit kept",
  );
  assert.equal(classCancelledOutcome(cancelled({ outcome: "nothing_to_return", credits_used: 0 })), "Nothing to return");
  assert.equal(
    classCancelledOutcome(cancelled({ late: true, outcome: "nothing_to_return", credits_used: 0 })),
    "Late cancel · nothing to return",
  );
});

test("ACC-33 a class the studio cancelled says so in its outcome line", () => {
  const studio = (over: Partial<CancelledClass>) => classCancelledOutcome(cancelled({ cancelled_by: "studio", ...over }));
  assert.equal(studio({}), "Cancelled by the studio · credit returned");
  assert.equal(studio({ credits_used: 3 }), "Cancelled by the studio · 3 credits returned");
  assert.equal(studio({ outcome: "credit_kept" }), "Cancelled by the studio · credit kept");
  assert.equal(studio({ outcome: "nothing_to_return", credits_used: 0 }), "Cancelled by the studio · nothing to return");
});

test("ACC-33 a cancelled class says when it was cancelled, and by whom where its outcome line does not", () => {
  assert.equal(cancelledWhen("member", "3 Oct · 10:15"), "You cancelled · 3 Oct · 10:15");
  // "Cancelled by the studio" is already its outcome line: said once per card.
  assert.equal(cancelledWhen("studio", "3 Oct · 10:15"), "Cancelled · 3 Oct · 10:15");
  assert.equal(cancelledStanding("member"), "You cancelled this booking");
  assert.equal(cancelledStanding("studio"), "The studio cancelled this booking");
});

test("ACC-33 no cancelled-class line calls a returned credit a refund", () => {
  const outcomes = ["credit_returned", "credit_kept_late", "credit_kept_over_cap", "credit_kept", "nothing_to_return"] as const;
  for (const by of ["member", "studio"] as const) {
    for (const outcome of outcomes) {
      const s = classCancelledOutcome(cancelled({ cancelled_by: by, outcome }));
      assert.doesNotMatch(s, /refund/i, s);
    }
  }
});
