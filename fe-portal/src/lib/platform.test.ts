import test from "node:test";
import assert from "node:assert/strict";
import { suggestSlug } from "./platform";

test("a studio name becomes a plausible slug", () => {
  assert.equal(suggestSlug("Acme Yoga"), "acme-yoga");
  assert.equal(suggestSlug("Northwind Studio"), "northwind-studio");
});

test("punctuation collapses rather than accumulating hyphens", () => {
  assert.equal(suggestSlug("Bob's  Yoga & Pilates!"), "bob-s-yoga-pilates");
  assert.equal(suggestSlug("  spaced out  "), "spaced-out");
});

test("the result is always a legal DNS label, or empty", () => {
  // Never leading or trailing hyphens, whatever the input ended with.
  assert.equal(suggestSlug("---weird---"), "weird");
  assert.equal(suggestSlug("!!!"), "");
  // Truncation must not leave a trailing hyphen behind either.
  const long = suggestSlug(`${"a".repeat(62)} b`);
  assert.equal(long.length <= 63, true);
  assert.equal(long.endsWith("-"), false);
});
