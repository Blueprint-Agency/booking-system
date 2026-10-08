import test from "node:test";
import assert from "node:assert/strict";
import {
  paymentLabel,
  readReceiptsState,
  receiptAmount,
  receiptKindLabel,
  receiptStatusLabel,
  receiptsExportPath,
  receiptsQuery,
  receiptsSearch,
  resendRefusal,
  type ReceiptsState,
} from "./receipts";

// INV-53: what the admin Receipts page reads and sends.

test("INV-53 amounts read to the cent, as the member's Receipt prints them", () => {
  assert.equal(receiptAmount("150"), "S$150.00");
  assert.equal(receiptAmount("135.5"), "S$135.50");
  assert.equal(receiptAmount("0.00"), "S$0.00");
});

test("INV-53 a payment reads as the member's Receipt words it", () => {
  assert.equal(paymentLabel({ method: "card", card_brand: "visa", card_last4: "4242", wallet: null }), "Visa •••• 4242");
  assert.equal(
    paymentLabel({ method: "card", card_brand: "mastercard", card_last4: "4444", wallet: "apple_pay" }),
    "Apple Pay · Mastercard •••• 4444",
  );
  assert.equal(paymentLabel({ method: "paynow", card_brand: null, card_last4: null, wallet: null }), "PayNow");
  assert.equal(paymentLabel({ method: null, card_brand: null, card_last4: null, wallet: null }), "Online payment");
});

test("INV-53 every kind of sale and both statuses have a name", () => {
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

test("INV-53 the list asks only for what is set: a search, the days picked, a kind, a status and the page", () => {
  assert.deepEqual(receiptsQuery(everything), { page: 1, page_size: 25 });
  assert.deepEqual(
    receiptsQuery({ q: "  R-000123 ", from: "2026-01-01", to: "2026-01-31", kind: "merch", status: "refunded", page: 3, pageSize: 50 }),
    { q: "R-000123", from: "2026-01-01", to: "2026-01-31", kind: "merch", status: "refunded", page: 3, page_size: 50 },
  );
});

test("INV-53 the list's position survives the address bar, and nonsense in it is ignored", () => {
  const state: ReceiptsState = { q: "mia", from: "2026-02-01", to: "2026-02-28", kind: "workshop", status: "issued", page: 2, pageSize: 50 };
  assert.deepEqual(readReceiptsState(receiptsSearch(state)), state);
  assert.equal(receiptsSearch(everything), "");
  assert.deepEqual(readReceiptsState("?kind=gift_card&status=void&page=-1&size=7&from=soon"), everything);
});

// INV-84: what the Export CSV and Resend buttons send and say.

test("INV-84 Export CSV asks for the list's search and filters, and never its page", () => {
  assert.equal(receiptsExportPath({ ...everything, page: 4, pageSize: 100 }), "/portal/admin/receipts/export.csv");
  assert.equal(
    receiptsExportPath({ q: " Mia & Leo ", from: "2026-01-01", to: "2026-01-31", kind: "merch", status: "refunded", page: 3, pageSize: 50 }),
    "/portal/admin/receipts/export.csv?q=Mia+%26+Leo&from=2026-01-01&to=2026-01-31&kind=merch&status=refunded",
  );
});

test("INV-84 a refused resend says why, in words an admin can act on", () => {
  assert.equal(
    resendRefusal({ error: "receipt_member_deleted" }),
    "This member has been permanently deleted, so there is no one to send it to.",
  );
  assert.equal(
    resendRefusal({ error: "receipt_email_unavailable" }),
    "What this purchase granted is no longer there to put its email together. Download the PDF and send it another way.",
  );
  assert.equal(resendRefusal({ error: "receipt_not_found" }), "There is no such receipt at this studio.");
  assert.equal(resendRefusal(null), "The receipt could not be sent. Try again in a moment.");
});
