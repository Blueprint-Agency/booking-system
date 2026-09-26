import test from "node:test";
import assert from "node:assert/strict";
import { blurNumberOnWheel } from "./number-input";

const field = (type: string) => {
  let blurred = false;
  return { type, blur: () => void (blurred = true), blurred: () => blurred };
};

test("a scroll over a number field blurs it, so the scroll moves the page and not the value", () => {
  const pay = field("number");
  blurNumberOnWheel(pay);
  assert.equal(pay.blurred(), true);
});

test("a scroll over any other field leaves its focus alone", () => {
  for (const type of ["text", "email", "date", "time"]) {
    const other = field(type);
    blurNumberOnWheel(other);
    assert.equal(other.blurred(), false, type);
  }
});
