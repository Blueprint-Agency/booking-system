import test from "node:test";
import assert from "node:assert/strict";
import { blockedByPayments, NO_ONLINE_PAYMENTS } from "./online-payments-rule.ts";
import { checkoutErrorMessage } from "./checkout-messages.ts";
import { ERROR_CODES } from "./error-codes.ts";

test("PAY-30 a studio that takes no online payments blocks a paid purchase", () => {
  assert.equal(blockedByPayments(false, "120.00"), true);
  assert.equal(blockedByPayments(false, 45), true);
});

test("PAY-30 a $0 purchase is never blocked — it never reaches the payment provider", () => {
  assert.equal(blockedByPayments(false, "0.00"), false);
  assert.equal(blockedByPayments(false, 0), false);
});

test("PAY-30 a studio that takes payments, or one not yet known, is never blocked", () => {
  assert.equal(blockedByPayments(true, "120.00"), false);
  assert.equal(blockedByPayments(null, "120.00"), false);
});

test("PAY-30 a price that is not a number reads as paid, never as free", () => {
  assert.equal(blockedByPayments(false, "not a price"), true);
});

test("PAY-30 the server's refusal reads as the same plain sentence", () => {
  const message = checkoutErrorMessage({ error: ERROR_CODES.payments_not_configured }, "fallback");
  assert.equal(message, NO_ONLINE_PAYMENTS);
});
