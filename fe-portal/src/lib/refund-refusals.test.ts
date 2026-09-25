import test from "node:test";
import assert from "node:assert/strict";
import { refundRefusal } from "./refund-refusals";
import { ERROR_CODES } from "./error-codes";

test("PAY-34 a Refund at a studio that takes no online payments says so, not an HTTP status", () => {
  const message = refundRefusal({ error: ERROR_CODES.payments_not_configured }, "Refund failed (HTTP 409).");
  assert.match(message, /isn't taking online payments/);
});

test("PAY-33 a Refund on a platform-account payment points the admin at the Stripe dashboard", () => {
  const message = refundRefusal({ error: ERROR_CODES.payment_on_platform_account }, "Refund failed (HTTP 409).");
  assert.match(message, /Stripe dashboard/);
});

test("PAY-33 a refusal it does not know keeps the caller's words", () => {
  assert.equal(refundRefusal({ error: "already_refunded" }, "fallback"), "fallback");
  assert.equal(refundRefusal(null, "fallback"), "fallback");
  assert.equal(refundRefusal("not a body", "fallback"), "fallback");
});
