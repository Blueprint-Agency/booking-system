import test from "node:test";
import assert from "node:assert/strict";
import {
  displayNameProblem,
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
      business_name: " Example Pte. Ltd. ",
      display_name: " Example ",
      prefix: " NW ",
      registration_number: "",
      address: "1 Example Street\n#02-03",
      footer: "   ",
    }),
    {
      business_name: "Example Pte. Ltd.",
      display_name: "Example",
      prefix: "NW",
      registration_number: null,
      address: "1 Example Street\n#02-03",
      footer: null,
    },
  );
  assert.deepEqual(receiptDetailsPayload(emptyReceiptDetailsDraft()).prefix, "R");
  assert.deepEqual(
    receiptDetailsDraft({
      business_name: "Example",
      display_name: "Ex",
      prefix: "R",
      registration_number: "REG 1",
      address: null,
      footer: null,
    }),
    { business_name: "Example", display_name: "Ex", prefix: "R", registration_number: "REG 1", address: "", footer: "" },
  );
});

test("INV-46 the create form sends receipt details only when the operator filled any in", () => {
  assert.equal(hasReceiptDetails(emptyReceiptDetailsDraft()), false);
  assert.equal(hasReceiptDetails({ ...emptyReceiptDetailsDraft(), prefix: " " }), false);
  assert.equal(hasReceiptDetails({ ...emptyReceiptDetailsDraft(), prefix: "NW" }), true);
  assert.equal(hasReceiptDetails({ ...emptyReceiptDetailsDraft(), footer: "Thanks" }), true);
  assert.equal(hasReceiptDetails({ ...emptyReceiptDetailsDraft(), display_name: "Acme" }), true);
});

test("TEN-42 a blank or overlong Display name is caught as it is typed, in the backend's words", () => {
  assert.equal(displayNameProblem("Acme Yoga"), null);
  assert.equal(displayNameProblem("   "), "A display name is required.");
  assert.equal(displayNameProblem("x".repeat(201)), "At most 200 characters.");
});
