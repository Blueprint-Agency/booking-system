import test from "node:test";
import assert from "node:assert";
import { addCustomerError } from "./add-customer";
import { ApiError } from "./api";

test("CUS-27 a refused Add customer shows the backend's sentence, not a bare HTTP status", () => {
  assert.strictEqual(
    addCustomerError(
      new ApiError(400, {
        error: "invalid_request",
        message: "A phone number is 7 to 15 digits, optionally starting with +.",
      }),
    ),
    "A phone number is 7 to 15 digits, optionally starting with +.",
  );
  assert.strictEqual(
    addCustomerError(new ApiError(409, { error: "email_in_use", message: "A client with this email already exists." })),
    "A client with this email already exists.",
  );
  assert.strictEqual(addCustomerError(new ApiError(500, null)), "Could not create customer (HTTP 500).");
  assert.strictEqual(addCustomerError(new TypeError("fetch failed")), "Could not create customer.");
});
