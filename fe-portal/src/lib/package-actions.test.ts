import test from "node:test";
import assert from "node:assert";
import { packageActions, type PackageMenuInput } from "./package-actions";

const pkg = (over: Partial<PackageMenuInput>): PackageMenuInput => ({
  kind: "credit_bundle",
  cross_location_paid_sgd: null,
  refundable: false,
  refund_progress: "none",
  complimentary: false,
  voided: false,
  ...over,
});

const labels = (p: PackageMenuInput) => packageActions(p).map((a) => a.label);

test("PKG-45 a refunded package offers no balance, expiry, Add-On, Home Location, Bound Instructor or manual adjustment edit", () => {
  for (const kind of ["credit_bundle", "trial", "unlimited", "pt"] as const) {
    assert.deepStrictEqual(labels(pkg({ kind, voided: true })), [], kind);
  }
  assert.deepStrictEqual(
    labels(pkg({ kind: "unlimited", voided: true, refundable: true, refund_progress: "incomplete" })),
    ["Refund purchase…"],
    "a Refund that returned only part of the money is still offered for the rest",
  );
});

test("PKG-45 an expired or used-up package that was never refunded keeps its edits", () => {
  assert.deepStrictEqual(labels(pkg({ kind: "credit_bundle" })), [
    "Set credit balance",
    "Edit expiry",
    "Manual adjustment",
  ]);
  assert.deepStrictEqual(labels(pkg({ kind: "unlimited", cross_location_paid_sgd: "40.00" })), [
    "Edit expiry",
    "Edit Cross-Location Add-On",
    "Change home studio",
  ]);
  assert.deepStrictEqual(labels(pkg({ kind: "pt", refundable: true })), [
    "Edit expiry",
    "Change bound instructor",
    "Manual adjustment",
    "Refund purchase…",
  ]);
});
