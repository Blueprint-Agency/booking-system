import test from "node:test";
import assert from "node:assert/strict";
import { partnerLookupFailure } from "./partner-lookup.ts";

const answered = (status: number, body: unknown = null) =>
  Object.assign(new Error(`API error ${status}`), { status, body });

test("PT-170 a partner lookup the backend refused with a 400 is a badly formed email, not a failed lookup", () => {
  assert.equal(partnerLookupFailure(answered(400, { error: "validation_error" })), "invalid_email");
  assert.equal(partnerLookupFailure(answered(400)), "invalid_email");
});

test("PT-170 a partner lookup that failed any other way is a failed lookup, to try again", () => {
  const failures = [
    answered(500, { error: "internal_error" }),
    answered(502),
    answered(503, { error: "maintenance" }),
    answered(404),
    answered(429),
    new TypeError("Failed to fetch"),
    "dropped",
    null,
  ];
  for (const err of failures) assert.equal(partnerLookupFailure(err), "failed", String(err));
});
