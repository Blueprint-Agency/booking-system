import test from "node:test";
import assert from "node:assert/strict";
import {
  cancelledNotice,
  confirmationOutcome,
  confirmationEyebrow,
  NOT_GRANTED_COPY,
  syncedReceipt,
} from "./checkout-return.ts";

const params = (query: string) => new URLSearchParams(query);

test("PAY-26 a cancelled checkout says the member hasn't been charged", () => {
  // The account page (the standalone Add-On's cancel return), merch and the
  // review page all come back with `cancelled=1`.
  const notice = cancelledNotice(params("cancelled=1"));
  assert.ok(notice);
  assert.match(notice, /Payment cancelled/);
  assert.match(notice, /haven't been charged/);
});

test("PAY-26 a cancelled resumed purchase says so, and that the balance is still there", () => {
  const notice = cancelledNotice(params("resumed=6f1d6c1e-6e0a-4d4e-9d5b-3d1d0c7a2b11"));
  assert.ok(notice);
  assert.match(notice, /Payment cancelled/);
  assert.match(notice, /haven't been charged/);
  assert.match(notice, /still/i);
});

test("PAY-26 an ordinary visit shows no notice", () => {
  assert.equal(cancelledNotice(params("")), null);
  assert.equal(cancelledNotice(params("cancelled=0")), null);
  assert.equal(cancelledNotice(params("tab=cancelled")), null);
});

test("PAY-27 a confirmed sync is a payment, a pending one is not", () => {
  assert.equal(confirmationOutcome("cs_1", { ok: true, body: { status: "granted" } }), "confirmed");
  assert.equal(confirmationOutcome("cs_1", { ok: true, body: { status: "pending" } }), "pending");
});

test("PAY-27 a sync that failed or answered nothing we know is pending, never successful", () => {
  assert.equal(confirmationOutcome("cs_1", "failed"), "pending");
  assert.equal(confirmationOutcome("cs_1", { ok: false, body: { error: "session_not_found" } }), "pending");
  assert.equal(confirmationOutcome("cs_1", { ok: true, body: {} }), "pending");
  assert.equal(confirmationOutcome("cs_1", { ok: true, body: null }), "pending");
});

test("PAY-28 a $0 grant has no payment session, so it is free, not paid", () => {
  assert.equal(confirmationOutcome(null, "failed"), "free");
  assert.equal(confirmationOutcome(null, { ok: true, body: { status: "granted" } }), "free");
});

test("PAY-28 only a confirmed payment is ever called successful", () => {
  assert.equal(confirmationEyebrow("confirmed"), "Payment successful");
  assert.equal(confirmationEyebrow("free"), "Added to your account");
  assert.doesNotMatch(confirmationEyebrow("pending"), /successful/i);
  assert.doesNotMatch(confirmationEyebrow("free"), /payment/i);
});

test("INV-10 the confirmation links the Receipt the sync named, and nothing when it named none", () => {
  const receipt = { id: "6f1d6c1e-6e0a-4d4e-9d5b-3d1d0c7a2b11", number: "R-000042" };
  assert.deepEqual(syncedReceipt({ ok: true, body: { status: "granted", receipt } }), receipt);
  assert.equal(syncedReceipt({ ok: true, body: { status: "granted", receipt: null } }), null);
  assert.equal(syncedReceipt({ ok: true, body: { status: "pending" } }), null);
  assert.equal(syncedReceipt({ ok: false, body: { error: "forbidden" } }), null);
  assert.equal(syncedReceipt("failed"), null);
});

test("PAY-68 a sync that says the Purchase was refunded or abandoned is neither a payment confirmed nor one still pending", () => {
  assert.equal(confirmationOutcome("cs_1", { ok: true, body: { status: "refunded" } }), "refunded");
  assert.equal(confirmationOutcome("cs_1", { ok: true, body: { status: "abandoned" } }), "abandoned");
  const receipt = { id: "6f1d6c1e-6e0a-4d4e-9d5b-3d1d0c7a2b11", number: "R-000042" };
  assert.equal(syncedReceipt({ ok: true, body: { status: "refunded", receipt } }), null);
});

test("PAY-68 a refunded or abandoned purchase is never called successful, and says nothing was added and the money goes back", () => {
  for (const outcome of ["refunded", "abandoned"] as const) {
    assert.doesNotMatch(confirmationEyebrow(outcome), /successful/i);
    const { heading, body } = NOT_GRANTED_COPY[outcome];
    assert.doesNotMatch(heading, /all set|booked|thank you|active/i);
    assert.match(body, /nothing/i);
    assert.match(body, /the way you paid \(card or PayNow\)/);
  }
  assert.notEqual(NOT_GRANTED_COPY.refunded.heading, NOT_GRANTED_COPY.abandoned.heading);
  assert.match(NOT_GRANTED_COPY.abandoned.body, /If you still need it, you can buy it again or contact the studio\./);
  assert.doesNotMatch(NOT_GRANTED_COPY.abandoned.body, /whenever you're ready/);
});

test("PAY-69 a part payment the sync counted towards a Balance is a payment confirmed, and a status the page does not know stays pending", () => {
  assert.equal(confirmationOutcome("cs_1", { ok: true, body: { status: "owing", purchase: { outstanding_sgd: "100.00" } } }), "confirmed");
  assert.equal(confirmationOutcome("cs_1", { ok: true, body: { status: "constructor" } }), "pending");
  assert.equal(confirmationOutcome("cs_1", { ok: true, body: { status: "paid" } }), "pending");
});
