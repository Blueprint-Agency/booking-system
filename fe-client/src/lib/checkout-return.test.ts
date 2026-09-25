import test from "node:test";
import assert from "node:assert/strict";
import { cancelledNotice, confirmationOutcome, confirmationEyebrow } from "./checkout-return.ts";

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
