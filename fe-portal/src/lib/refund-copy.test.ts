import test from "node:test";
import assert from "node:assert/strict";
import {
  REFUND_PROCESSING_LABEL,
  refundEffects,
  refundFailureMessage,
  refundIssuedMessage,
  refundProgressTag,
  refundReplyToast,
  splitPaymentLines,
} from "./refund-copy";

test("RFD-13 every refund refusal has a staff-facing message and none shows an HTTP status", () => {
  const codes = ["already_refunded", "purchase_not_refundable", "purchase_not_open", "refund_processing"];
  for (const code of codes) {
    const msg = refundFailureMessage({ error: code });
    assert.ok(msg.length > 0, code);
    assert.doesNotMatch(msg, /HTTP|\d{3}/, `${code} reads as words, not a status code`);
  }
  assert.equal(refundFailureMessage({ error: "already_refunded" }), "This purchase has already been refunded.");
  assert.equal(
    refundFailureMessage({ error: "purchase_not_refundable" }),
    "Nothing was paid online for this, so there's nothing to refund.",
  );
});

test("a refund that failed for no named reason still says where to look, without a status code", () => {
  const msg = refundFailureMessage({ error: "internal_error" });
  assert.doesNotMatch(msg, /HTTP|500/);
  assert.match(msg, /Stripe/);
  assert.doesNotMatch(refundFailureMessage(null), /HTTP/);
});

test("RFD-11 a Refund that stopped part-way is a warning that some of it may have gone through", () => {
  const toast = refundReplyToast("package", { complete: false, requested_count: 1, covered_payment_count: 2 });
  assert.equal(toast.tone, "warning");
  assert.match(toast.message, /^Some of this refund may have gone through\./);
  assert.match(toast.message, /Check Stripe before you try again\./);
  assert.match(toast.message, /1 of 2 payments/);
  assert.deepEqual(refundProgressTag("incomplete"), { label: "Refund incomplete", tone: "error" });
});

test("a finished Refund is a success, led by the backend's own line when it sends one", () => {
  const done = { complete: true, requested_count: 2, covered_payment_count: 2 };
  assert.deepEqual(refundReplyToast("package", done), {
    tone: "success",
    message: "Refund issued. The package is voided once Stripe confirms.",
  });
  assert.equal(
    refundReplyToast("unfinished", done, "2 payments returned, totalling S$120.00").message,
    "2 payments returned, totalling S$120.00. Refund issued. The purchase closes once Stripe confirms.",
  );
});

test("the toast after issuing a Refund names Stripe, not 'the provider'", () => {
  for (const kind of ["package", "workshop", "unfinished"] as const) {
    const msg = refundIssuedMessage(kind);
    assert.match(msg, /Stripe/);
    assert.doesNotMatch(msg, /provider/i);
  }
});

test("a purchase paid in two payments says two refunds will show, not two cards", () => {
  const [head, detail] = splitPaymentLines(2);
  assert.equal(head, "This was paid in 2 payments, so 2 refunds will show on the statement.");
  assert.doesNotMatch(`${head} ${detail}`, /cards/);
});

test("RFD-12 the Refund dialog names the amount and everything the Refund undoes", () => {
  const lines = refundEffects({
    kind: "package",
    amountSgd: "260.00",
    crossLocationPaidSgd: "60.00",
    includesAddOn: true,
    upcomingBookingCount: 2,
    promoCode: "LAUNCH10",
  });
  assert.deepEqual(lines, [
    "S$260.00 goes back to the customer, including the Cross-Location Add-On (S$60.00).",
    "The package stops covering bookings.",
    "Their 2 upcoming bookings on it are cancelled.",
    "Promo Code LAUNCH10 is freed, so they can use it again.",
  ]);
});

test("an Add-On bought separately is said to end, not to be refunded", () => {
  const [amount, , , addOn] = refundEffects({
    kind: "package",
    amountSgd: "200.00",
    crossLocationPaidSgd: "60.00",
    includesAddOn: false,
    upcomingBookingCount: 0,
    promoCode: null,
  });
  assert.equal(amount, "S$200.00 goes back to the customer.");
  assert.match(addOn!, /Cross-Location Add-On .* ends with the package and is not refunded/);
});

test("a package with nothing booked ahead says so rather than promising cancellations", () => {
  const lines = refundEffects({
    kind: "package",
    amountSgd: "90.00",
    crossLocationPaidSgd: null,
    includesAddOn: null,
    upcomingBookingCount: 0,
    promoCode: null,
  });
  assert.ok(lines.includes("Nothing is booked on it yet, so no bookings are cancelled."));
  assert.ok(!lines.some((l) => /Promo Code|Add-On/.test(l)));
});

test("a workshop Refund cancels the place; an unfinished purchase cancels nothing", () => {
  const workshop = refundEffects({ kind: "workshop", amountSgd: "120.00", promoCode: null });
  assert.deepEqual(workshop, [
    "S$120.00 goes back to the customer.",
    "Their place on the workshop is cancelled.",
  ]);
  const unfinished = refundEffects({ kind: "unfinished", amountSgd: "50.00", promoCode: null });
  assert.equal(unfinished[0], "S$50.00 goes back to the customer.");
  assert.match(unfinished[1]!, /Nothing was ever issued on it/);
});

test("a pending Refund has one label everywhere, and nothing in flight has none", () => {
  assert.equal(REFUND_PROCESSING_LABEL, "Refund processing");
  assert.deepEqual(refundProgressTag("processing"), { label: "Refund processing", tone: "warning" });
  assert.equal(refundProgressTag("none"), null);
});
