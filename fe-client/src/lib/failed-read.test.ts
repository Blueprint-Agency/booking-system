import test from "node:test";
import assert from "node:assert/strict";
import { afterFailedRead } from "./failed-read.ts";

/** A refused call, shaped as `ApiError` carries it. */
const answered = (status: number, body: unknown) => Object.assign(new Error(`API error ${status}`), { status, body });

test("SUP-36 a read the studio or the session refused stays loading while the app answers the refusal", () => {
  const elsewhere = [
    answered(403, { error: "tenant_suspended", status: "suspended" }),
    answered(403, { error: "tenant_mismatch" }),
    answered(401, { error: "invalid_token" }),
    answered(503, { error: "maintenance", message: "Back soon" }),
  ];
  for (const err of elsewhere) {
    assert.deepEqual(afterFailedRead(err), { data: null, loading: true }, err.message);
    assert.deepEqual(afterFailedRead(err, { optional: true }), { data: null, loading: true }, err.message);
  }
});

test("SUP-36 any other failed read is thrown to the page's error state, never drawn as an empty list or a zero", () => {
  const failures = [
    answered(500, { error: "internal_error" }),
    answered(403, { error: "client_blocked" }),
    answered(404, { error: "client_not_found" }),
    answered(503, "Service Unavailable"),
    new TypeError("Failed to fetch"),
    Object.assign(new Error("The operation timed out."), { name: "TimeoutError" }),
  ];
  for (const err of failures) {
    assert.throws(() => afterFailedRead(err), (thrown) => thrown === err, err.message);
  }
});

test("SUP-36 an optional read that fails is drawn as nothing at all, not as loading and not as a value", () => {
  assert.deepEqual(afterFailedRead(answered(500, { error: "internal_error" }), { optional: true }), {
    data: null,
    loading: false,
  });
  assert.deepEqual(afterFailedRead(new TypeError("Failed to fetch"), { optional: true }), { data: null, loading: false });
});
