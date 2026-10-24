/**
 * How a card's brand reads to the member who paid with it (#185).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { cardBrandLabel } from "./saved-cards.ts";

test("a brand is named the way its owner would say it", () => {
  assert.equal(cardBrandLabel("visa"), "Visa");
  assert.equal(cardBrandLabel("mastercard"), "Mastercard");
  assert.equal(cardBrandLabel("amex"), "American Express");
});

test("a brand nobody wrote down is still shown, not blanked", () => {
  // A provider adding a network must not leave a member looking at a card with
  // no name on it.
  assert.equal(cardBrandLabel("cartes_bancaires"), "Cartes_bancaires");
  assert.equal(cardBrandLabel("unknown"), "Unknown");
});
