import test from "node:test";
import assert from "node:assert/strict";
import { billToPayLabel } from "./bill-to-status.ts";

test("PAY-58 Pay names why it waits on Bill to: loading, a list that failed to load (try again), or none saved; and nothing once a set is chosen", () => {
  assert.equal(billToPayLabel("ready", false), "Add your billing details to continue");

  const failed = billToPayLabel("failed", false);
  assert.ok(failed, "a failed list still holds Pay");
  assert.match(failed, /couldn.t load/i);
  assert.match(failed, /try again/i);
  assert.doesNotMatch(failed, /add your billing details/i, "a member who has sets is not told to add one");

  const loading = billToPayLabel("loading", false);
  assert.ok(loading);
  assert.match(loading, /loading/i);
  assert.doesNotMatch(loading, /add your billing details/i);

  for (const status of ["ready", "failed", "loading"] as const) {
    assert.equal(billToPayLabel(status, true), null, `${status} with a set chosen`);
  }
});
