import { test } from "node:test";
import assert from "node:assert/strict";
import { movementLine, type CreditMovement } from "./credit-history";

// A package's Credit history on the profile (#353): each movement in words,
// never a raw code like `client_cancellation_refund`.

const base: CreditMovement = {
  id: "m1",
  at: "2026-10-07T01:00:00.000Z",
  cause: "booked",
  delta: -1,
  balance_after: 4,
  actor: "member",
  booking: { id: "b1", kind: "class", title: "Hatha", starts_at: "2026-10-08T01:00:00.000Z", cancelled_late: null },
  staff_name: null,
  note: null,
};

test("CRD-28 a booking spends, a cancel in time returns, each with its signed amount and the balance after", () => {
  assert.deepEqual(movementLine(base, "credit"), { label: "Booked", amount: "-1", balance: 4 });
  assert.deepEqual(movementLine({ ...base, cause: "returned", delta: 1, balance_after: 5 }, "credit"), {
    label: "Returned",
    amount: "+1",
    balance: 5,
  });
});

test("CRD-28 a kept credit says why it stayed spent", () => {
  const kept = { ...base, cause: "kept" as const, delta: 0 };
  const late = { ...kept, booking: { ...base.booking!, cancelled_late: true } };
  assert.equal(movementLine(late, "credit").label, "Late cancel · credit kept");
  assert.equal(movementLine({ ...kept, booking: { ...base.booking!, cancelled_late: false } }, "credit").label, "Over the cancellation limit · credit kept");
  assert.equal(movementLine({ ...late, actor: "staff" }, "credit").label, "Staff cancel · credit kept");
  assert.equal(movementLine({ ...kept, cause: "no_show" }, "session").label, "No-show · session kept");
  assert.equal(movementLine(late, "credit").amount, null, "nothing moved, so no amount");
});

test("CRD-28 an expiry reads as what it took, and leaves nothing usable", () => {
  const expired = { ...base, cause: "expired" as const, delta: 0, balance_after: 3, booking: null, actor: "system" as const };
  assert.deepEqual(movementLine(expired, "credit"), { label: "Expired", amount: "-3", balance: 0 });
  assert.deepEqual(movementLine({ ...expired, balance_after: 0 }, "credit"), { label: "Expired", amount: null, balance: 0 });
  assert.deepEqual(movementLine({ ...expired, balance_after: null }, "credit"), { label: "Expired", amount: null, balance: null });
});

test("CRD-28 staff adjustments and private session requests in words", () => {
  const adjusted = { ...base, cause: "adjusted" as const, delta: 2, balance_after: 6, booking: null, actor: "staff" as const };
  assert.deepEqual(movementLine(adjusted, "credit"), { label: "Adjusted by staff", amount: "+2", balance: 6 });
  assert.equal(movementLine({ ...adjusted, delta: 0 }, "credit").amount, null);
  assert.equal(movementLine({ ...base, cause: "pt_requested" }, "session").label, "Private session requested");
  assert.equal(movementLine({ ...base, cause: "pt_returned", delta: 1 }, "session").label, "Request cancelled · returned");
});
