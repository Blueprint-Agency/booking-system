import { test } from "node:test";
import assert from "node:assert/strict";
import { creditKept } from "./cancellations";

// How staff read a cancellation on the profile and the roster (#352). Who and
// where the credit went are the server's lines
// (be/src/services/bookings/cancellation-summary.test.ts, CUS-25); the tone is this app's.

test("CUS-25 a kept credit is the warning; anything returned, refunded or not spent is not", () => {
  assert.equal(creditKept({ outcome: "credit_kept_late" }), true);
  assert.equal(creditKept({ outcome: "credit_kept_over_cap" }), true);
  assert.equal(creditKept({ outcome: "credit_kept" }), true);
  for (const outcome of ["credit_returned", "refunded", "nothing_to_return"] as const) {
    assert.equal(creditKept({ outcome }), false, outcome);
  }
});
