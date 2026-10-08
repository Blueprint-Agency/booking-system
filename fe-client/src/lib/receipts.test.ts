/**
 * How a Receipt reads to the member it was issued to (#384): its amounts in
 * the studio's one money form, how each payment was made, and the date filter
 * the Receipts page sends.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { dateRangeProblem, paymentLabel, receiptAmount, receiptsQuery, receiptStatusLabel } from "./receipts.ts";

test("INV-09 amounts print as the studio prints money to members, always to the cent", () => {
  assert.equal(receiptAmount("150.00"), "S$150.00");
  assert.equal(receiptAmount("150"), "S$150.00");
  assert.equal(receiptAmount("0.00"), "S$0.00");
  // The same form as the confirmation emails (the backend's `sgdText`): no separator.
  assert.equal(receiptAmount("1234.5"), "S$1234.50");
});

test("INV-09 a card payment names its brand and last four, and the wallet it was in", () => {
  const card = { method: "card", card_brand: "visa", card_last4: "4242", wallet: null };
  assert.equal(paymentLabel(card), "Visa •••• 4242");
  assert.equal(paymentLabel({ ...card, wallet: "apple_pay" }), "Apple Pay · Visa •••• 4242");
  assert.equal(paymentLabel({ method: "paynow", card_brand: null, card_last4: null, wallet: null }), "PayNow");
  assert.equal(paymentLabel({ method: null, card_brand: null, card_last4: null, wallet: null }), "Online payment");
});

test("INV-09 a Receipt reads Issued, or Refunded once the money went back", () => {
  assert.equal(receiptStatusLabel("issued"), "Issued");
  assert.equal(receiptStatusLabel("refunded"), "Refunded");
});

test("INV-09 the date filter sends only the days that were picked, and the page", () => {
  assert.deepEqual(receiptsQuery({ from: "", to: "", page: 1 }), { page: 1 });
  assert.deepEqual(receiptsQuery({ from: "2026-01-01", to: "", page: 2 }), { from: "2026-01-01", page: 2 });
  assert.deepEqual(receiptsQuery({ from: "2026-01-01", to: "2026-12-31", page: 1 }), { from: "2026-01-01", to: "2026-12-31", page: 1 });
});

test("INV-09 a range that ends before it starts is refused before it is sent", () => {
  assert.equal(dateRangeProblem("2026-02-01", "2026-01-31"), "The end date is before the start date.");
  assert.equal(dateRangeProblem("2026-01-31", "2026-01-31"), null);
  assert.equal(dateRangeProblem("", "2026-01-31"), null);
});
