import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelledByLabel, cancelledOutcomeLine, creditKept, type StaffCancellation } from "./cancellations";

// How staff read a cancellation on the profile and the roster (#352).

const base: StaffCancellation = {
  cancelled_at: "2026-10-07T07:00:00.000Z",
  cancelled_by: "member",
  cancelled_by_name: null,
  late: false,
  outcome: "credit_returned",
  credits_used: 1,
};

test("CUS-25 who cancelled: the member, the named staff member, Automatic, or the studio for an unnamed old cancel", () => {
  assert.equal(cancelledByLabel(base), "Member");
  assert.equal(cancelledByLabel({ cancelled_by: "staff", cancelled_by_name: "Ana Tan" }), "Ana Tan");
  assert.equal(cancelledByLabel({ cancelled_by: "automatic", cancelled_by_name: null }), "Automatic");
  assert.equal(cancelledByLabel({ cancelled_by: "studio", cancelled_by_name: null }), "Studio");
});

test("CUS-25 where the credit went: returned with its count, kept with why, refunded only for money, and a session for a private session", () => {
  assert.equal(cancelledOutcomeLine(base), "Credit returned");
  assert.equal(cancelledOutcomeLine({ ...base, credits_used: 2 }), "2 credits returned");
  assert.equal(cancelledOutcomeLine({ ...base, late: true, outcome: "credit_kept_late" }), "Late cancel · credit kept");
  assert.equal(cancelledOutcomeLine({ ...base, outcome: "credit_kept_over_cap" }), "Over cap · credit kept");
  assert.equal(cancelledOutcomeLine({ ...base, outcome: "credit_kept" }), "Credit kept");
  assert.equal(cancelledOutcomeLine({ ...base, outcome: "nothing_to_return", credits_used: 0 }), "Nothing to return");
  assert.equal(cancelledOutcomeLine({ ...base, outcome: "refunded", credits_used: 0 }, "workshop"), "Refunded");
  assert.equal(cancelledOutcomeLine(base, "pt"), "Session returned");
  assert.equal(cancelledOutcomeLine({ ...base, outcome: "credit_kept" }, "pt"), "Session kept");
});

test("CUS-25 a kept credit is the warning; anything returned, refunded or not spent is not", () => {
  assert.equal(creditKept({ outcome: "credit_kept_late" }), true);
  assert.equal(creditKept({ outcome: "credit_kept_over_cap" }), true);
  assert.equal(creditKept({ outcome: "credit_kept" }), true);
  for (const outcome of ["credit_returned", "refunded", "nothing_to_return"] as const) {
    assert.equal(creditKept({ outcome }), false, outcome);
  }
});
