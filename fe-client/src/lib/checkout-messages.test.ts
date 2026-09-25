import test from "node:test";
import assert from "node:assert/strict";
import { checkoutErrorMessage } from "./checkout-messages.ts";
import { ERROR_CODES } from "./error-codes.ts";

const FALLBACK = "Could not start checkout. Please try again.";

test("PAY-25 a full workshop is said in words, never as its code", () => {
  const message = checkoutErrorMessage({ error: ERROR_CODES.workshop_full }, FALLBACK);
  assert.match(message, /full/i);
  assert.doesNotMatch(message, /workshop_full/);
});

test("PAY-25 the server's own sentence wins over the code it came with", () => {
  const message = checkoutErrorMessage(
    { error: ERROR_CODES.part_payment_below_floor, message: "A part payment has to be at least S$1.00." },
    FALLBACK,
  );
  assert.equal(message, "A part payment has to be at least S$1.00.");
});

test("PAY-25 the refusals a checkout can meet each get a member-facing sentence", () => {
  const codes = [
    ERROR_CODES.already_booked,
    ERROR_CODES.workshop_not_active,
    ERROR_CODES.workshop_cancelled,
    ERROR_CODES.workshop_not_found,
    ERROR_CODES.workshop_tier_not_found,
    ERROR_CODES.class_package_not_found,
    ERROR_CODES.class_package_not_active,
    ERROR_CODES.pt_package_not_found,
    ERROR_CODES.pt_package_not_active,
    ERROR_CODES.package_archived,
    ERROR_CODES.trial_already_used,
    ERROR_CODES.trial_not_eligible,
    ERROR_CODES.unlimited_limit_reached,
    ERROR_CODES.unlimited_renewal_location_mismatch,
    ERROR_CODES.unlimited_requires_location,
    ERROR_CODES.pt_bound_requires_instructor,
    ERROR_CODES.merch_not_available,
    ERROR_CODES.merch_not_found,
    ERROR_CODES.checkout_session_busy,
    ERROR_CODES.purchase_not_open,
    ERROR_CODES.purchase_settled,
    ERROR_CODES.part_payment_unavailable,
    ERROR_CODES.cross_location_already_added,
    ERROR_CODES.cross_location_plan_not_live,
    ERROR_CODES.vendor_timeout,
    ERROR_CODES.rate_limited,
  ];
  for (const code of codes) {
    const message = checkoutErrorMessage({ error: code }, FALLBACK);
    assert.notEqual(message, FALLBACK, `${code} fell back to the generic sentence`);
    assert.doesNotMatch(message, /_/, `${code} came out as a code: ${message}`);
  }
});

test("PAY-25 a code it does not know gets the caller's words, never the raw string", () => {
  assert.equal(checkoutErrorMessage({ error: "internal_error" }, FALLBACK), FALLBACK);
  assert.equal(checkoutErrorMessage({ error: "something_new_on_the_server" }, FALLBACK), FALLBACK);
  assert.equal(checkoutErrorMessage({}, FALLBACK), FALLBACK);
  assert.equal(checkoutErrorMessage(null, FALLBACK), FALLBACK);
});

test("PAY-25 a message that is itself a code is not printed", () => {
  assert.equal(checkoutErrorMessage({ message: "workshop_full" }, FALLBACK), checkoutErrorMessage({ error: "workshop_full" }, FALLBACK));
  assert.equal(checkoutErrorMessage({ message: "internal_error" }, FALLBACK), FALLBACK);
});
