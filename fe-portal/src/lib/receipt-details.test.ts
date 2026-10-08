import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyReceiptDetailsDraft,
  hasReceiptDetails,
  receiptDetailsDraft,
  receiptDetailsPayload,
  receiptNumberPreview,
  receiptPrefixProblem,
} from "./receipt-details";

test("INV-46 the preview is the prefix being typed and the studio's next sequence, zero-padded as the Receipt prints it", () => {
  assert.equal(receiptNumberPreview("R", 1), "R-000001");
  assert.equal(receiptNumberPreview("NW", 124), "NW-000124");
  assert.equal(receiptNumberPreview("  SG-R ", 3), "SG-R-000003", "trimmed, as the backend saves it");
  assert.equal(receiptNumberPreview("", 7), "R-000007", "a blank prefix is the default");
  assert.equal(receiptNumberPreview("R", 1234567), "R-1234567", "past six digits the number just grows");
});

test("INV-46 a prefix that could not head a number is caught as it is typed, with the backend's rule", () => {
  for (const ok of ["R", "NW", "SG-R", "A1", "ABCDEFGHIJ", "", "  R  "]) {
    assert.equal(receiptPrefixProblem(ok), null, ok);
  }
  for (const bad of ["R 1", "R/1", "-R", "R-", "ABCDEFGHIJK", "Ré"]) {
    assert.ok(receiptPrefixProblem(bad), bad);
  }
});

test("INV-46 the form sends trimmed details with blanks as none, and reads saved ones back as it shows them", () => {
  assert.deepEqual(
    receiptDetailsPayload({
      prefix: " NW ",
      legal_name: " Example Pte. Ltd. ",
      registration_number: "",
      address: "1 Example Street\n#02-03",
      footer: "   ",
    }),
    {
      prefix: "NW",
      legal_name: "Example Pte. Ltd.",
      registration_number: null,
      address: "1 Example Street\n#02-03",
      footer: null,
    },
  );
  assert.deepEqual(receiptDetailsPayload(emptyReceiptDetailsDraft()).prefix, "R");
  assert.deepEqual(
    receiptDetailsDraft({ prefix: "R", legal_name: null, registration_number: "REG 1", address: null, footer: null }),
    { prefix: "R", legal_name: "", registration_number: "REG 1", address: "", footer: "" },
  );
});

test("INV-46 the create form sends receipt details only when the operator filled any in", () => {
  assert.equal(hasReceiptDetails(emptyReceiptDetailsDraft()), false);
  assert.equal(hasReceiptDetails({ ...emptyReceiptDetailsDraft(), prefix: " " }), false);
  assert.equal(hasReceiptDetails({ ...emptyReceiptDetailsDraft(), prefix: "NW" }), true);
  assert.equal(hasReceiptDetails({ ...emptyReceiptDetailsDraft(), footer: "Thanks" }), true);
});
