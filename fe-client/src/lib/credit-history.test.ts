import { test } from "node:test";
import assert from "node:assert/strict";
import { movementText, type CreditMovement } from "./credit-history.ts";

// My packages' Credit history (#353): "where did my credits go", one line per movement.

const booked: CreditMovement = {
  id: "m1",
  at: "2026-10-07T01:00:00.000Z",
  cause: "booked",
  delta: -1,
  balance_after: 4,
  actor: "member",
  booking: { id: "b1", kind: "class", title: "Hatha", starts_at: "2026-10-08T01:00:00.000Z", cancelled_late: null },
};

test("CRD-27 booked and returned read with their signed amount and the balance after", () => {
  assert.deepEqual(movementText(booked, "credit"), { text: "Booked · -1", balance: 4 });
  assert.deepEqual(movementText({ ...booked, cause: "returned", delta: 1, balance_after: 5 }, "credit"), {
    text: "Returned · +1",
    balance: 5,
  });
});

test("CRD-27 a credit kept says why, without an amount", () => {
  const kept = { ...booked, cause: "kept" as const, delta: 0 };
  assert.equal(movementText({ ...kept, booking: { ...booked.booking!, cancelled_late: true } }, "credit").text, "Late cancel · credit kept");
  assert.equal(movementText({ ...kept, booking: { ...booked.booking!, cancelled_late: false } }, "credit").text, "Over the cancellation limit · credit kept");
  assert.equal(movementText({ ...kept, actor: "staff" }, "credit").text, "Cancelled by the studio · credit kept");
  assert.equal(movementText({ ...kept, cause: "no_show" }, "session").text, "No-show · session kept");
});

test("CRD-27 an expiry takes what was left, leaving nothing to use", () => {
  const expired = { ...booked, cause: "expired" as const, delta: 0, balance_after: 3, booking: null, actor: "system" as const };
  assert.deepEqual(movementText(expired, "credit"), { text: "Expired · -3", balance: 0 });
  assert.deepEqual(movementText({ ...expired, balance_after: 0 }, "credit"), { text: "Expired", balance: 0 });
});

test("CRD-27 the studio's adjustments and private session requests", () => {
  const adjusted = { ...booked, cause: "adjusted" as const, delta: 2, balance_after: 6, booking: null, actor: "staff" as const };
  assert.equal(movementText(adjusted, "credit").text, "Adjusted by the studio · +2");
  assert.equal(movementText({ ...adjusted, delta: 0 }, "credit").text, "Updated by the studio");
  assert.equal(movementText({ ...booked, cause: "pt_requested" }, "session").text, "Session requested · -1");
  assert.equal(movementText({ ...booked, cause: "pt_returned", delta: 1 }, "session").text, "Request cancelled · +1");
});
