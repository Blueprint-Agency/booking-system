import test from "node:test";
import assert from "node:assert";
import { capacityProblem } from "./capacity";

test("SCH-35 a class with no online, waitlist or buffer place is held back with a reason before it is sent", () => {
  assert.match(
    String(capacityProblem({ onlineBooking: 0, waitlist: 0, buffer: 0 })),
    /at least one/i,
  );
  for (const seated of [
    { onlineBooking: 1, waitlist: 0, buffer: 0 },
    { onlineBooking: 0, waitlist: 1, buffer: 0 },
    { onlineBooking: 0, waitlist: 0, buffer: 1 },
  ]) {
    assert.strictEqual(capacityProblem(seated), null, JSON.stringify(seated));
  }
});
