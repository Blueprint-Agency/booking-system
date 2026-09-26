import test from "node:test";
import assert from "node:assert/strict";
import { payOrNull } from "./pay";

test("SCH-06 a blank pay field is sent as Unpriced (null), never S$0", () => {
  assert.equal(payOrNull(""), null);
  assert.equal(payOrNull("   "), null);
});

test("SCH-06 a typed 0 is a price, and any other figure is sent as typed", () => {
  assert.equal(payOrNull("0"), 0);
  assert.equal(payOrNull(" 200 "), 200);
  assert.equal(payOrNull("45.50"), 45.5);
});
