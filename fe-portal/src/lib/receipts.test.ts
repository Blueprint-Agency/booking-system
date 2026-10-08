import test from "node:test";
import assert from "node:assert/strict";
import {
  paymentLabel,
  readReceiptsState,
  receiptAmount,
  receiptKindLabel,
  receiptStatusLabel,
  receiptsQuery,
  receiptsSearch,
  type ReceiptsState,
} from "./receipts";

// INV-41: what the admin Receipts page reads and sends.

test("INV-41amounts read to the cent, as the member's Receipt prints them", () => {
  assert.equal(receiptAmount("150"), "S$150.00");
  assert.equal(receiptAmount("135.5"), "S$135.50");
  assert.equal(receiptAmount("0.00"), "S$0.00");
});

test("INV-41a payment reads as the member's Receipt words it", () => {
  assert.equal(paymentLabel({ method: "card", card_brand: "visa", card_last4: "4242", wallet: null }), "Visa •••• 4242");
  assert.equal(
    paymentLabel({ method: "card", card_brand: "mastercard", card_last4: "4444", wallet: "apple_pay" }),
    "Apple Pay · Mastercard •••• 4444",
  );
  assert.equal(paymentLabel({ method: "paynow", card_brand: null, card_last4: null, wallet: null }), "PayNow");
  assert.equal(paymentLabel({ method: null, card_brand: null, card_last4: null, wallet: null }), "Online payment");
});

test("INV-41every kind of sale and both statuses have a name", () => {
  assert.equal(receiptKindLabel("class_package"), "Class package");
  assert.equal(receiptKindLabel("pt_package"), "Private sessions");
  assert.equal(receiptKindLabel("workshop"), "Workshop");
  assert.equal(receiptKindLabel("merch"), "Merch");
  assert.equal(receiptKindLabel("cross_location_add_on"), "Cross-Location Add-On");
  assert.equal(receiptKindLabel("corporate_package"), "Corporate package");
  assert.equal(receiptStatusLabel("issued"), "Issued");
  assert.equal(receiptStatusLabel("refunded"), "Refunded");
});

const everything: ReceiptsState = { q: "", from: "", to: "", kind: "all", status: "all", page: 1, pageSize: 25 };

test("INV-41the list asks only for what is set: a search, the days picked, a kind, a status and the page", () => {
  assert.deepEqual(receiptsQuery(everything), { page: 1, page_size: 25 });
  assert.deepEqual(
    receiptsQuery({ q: "  R-000123 ", from: "2026-01-01", to: "2026-01-31", kind: "merch", status: "refunded", page: 3, pageSize: 50 }),
    { q: "R-000123", from: "2026-01-01", to: "2026-01-31", kind: "merch", status: "refunded", page: 3, page_size: 50 },
  );
});

test("INV-41the list's position survives the address bar, and nonsense in it is ignored", () => {
  const state: ReceiptsState = { q: "mia", from: "2026-02-01", to: "2026-02-28", kind: "workshop", status: "issued", page: 2, pageSize: 50 };
  assert.deepEqual(readReceiptsState(receiptsSearch(state)), state);
  assert.equal(receiptsSearch(everything), "");
  assert.deepEqual(readReceiptsState("?kind=gift_card&status=void&page=-1&size=7&from=soon"), everything);
});
