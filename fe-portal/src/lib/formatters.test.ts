import test from "node:test";
import assert from "node:assert";
import { isFilterDay } from "./formatters";

// FIN-58: a date input fires `input` with year 0001, or 0002 and 0020 on the
// way to typing 2026, whatever its `min` says; none of them may reach the API.
test("FIN-58 a day in the filter is a real four-digit-year day no earlier than 1900", () => {
  assert.equal(isFilterDay("2026-10-30"), true);
  assert.equal(isFilterDay("1900-01-01"), true);
  assert.equal(isFilterDay("9999-12-31"), true);
});

test("FIN-58 the years a browser passes through while one is typed are not filter days", () => {
  for (const partial of ["0001-01-01", "0002-10-30", "0020-10-30", "0202-10-30", "1899-12-31"]) {
    assert.equal(isFilterDay(partial), false, partial);
  }
});

test("FIN-58 an empty or six-digit-year value is not a filter day", () => {
  assert.equal(isFilterDay(""), false);
  assert.equal(isFilterDay("275760-09-13"), false);
});
