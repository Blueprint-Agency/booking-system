import test from "node:test";
import assert from "node:assert/strict";
import { outcomeRows } from "./classpass";

test("the import status lists every outcome, a missing one as 0, and totals them", () => {
  const { rows, total } = outcomeRows({ ignored: 4, refused: 1 });
  assert.equal(rows.length, 7);
  assert.equal(rows.find((r) => r.outcome === "ignored")?.count, 4);
  assert.equal(rows.find((r) => r.outcome === "refused")?.count, 1);
  assert.equal(rows.find((r) => r.outcome === "imported")?.count, 0);
  assert.equal(total, 5);
});
