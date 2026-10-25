import test from "node:test";
import assert from "node:assert";
import { refusalMessage } from "./refusal-message";
import { ApiError } from "./api";

test("SCH-40, LOC-17, PKG-47, SUP-37, PT-160 a refused portal form shows the API's sentence, and its own fallback when the API sent none", () => {
  assert.strictEqual(
    refusalMessage(
      new ApiError(400, { error: "invalid_request", message: "A name can be at most 120 characters." }),
      "Save failed (HTTP 400).",
    ),
    "A name can be at most 120 characters.",
  );
  assert.strictEqual(
    refusalMessage(new ApiError(400, { error: "invalid_request", message: "" }), "Save failed (HTTP 400)."),
    "Save failed (HTTP 400).",
  );
  assert.strictEqual(
    refusalMessage(new ApiError(400, { success: false, error: { issues: [] } }), "Save failed (HTTP 400)."),
    "Save failed (HTTP 400).",
  );
  assert.strictEqual(refusalMessage(new ApiError(500, "Internal Server Error"), "Save failed (HTTP 500)."), "Save failed (HTTP 500).");
  assert.strictEqual(refusalMessage(new TypeError("Failed to fetch"), "Save failed."), "Save failed.");
});
