import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_LOCATIONS, coversAllLocations } from "./package-coverage.ts";

test("PKG-34 a Credit Bundle and a Trial cover every Location", () => {
  assert.equal(coversAllLocations("credit_bundle"), true);
  assert.equal(coversAllLocations("trial"), true);
});

test("PKG-34 an Unlimited plan and a PT package do not claim every Location", () => {
  assert.equal(coversAllLocations("unlimited"), false);
  assert.equal(coversAllLocations("pt"), false);
});

test("PKG-34 the chip's wording is a constant, not a count of Locations", () => {
  assert.equal(ALL_LOCATIONS, "All locations");
});
