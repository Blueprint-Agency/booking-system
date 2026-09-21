/**
 * How a saved card reads to the member who owns it (#185).
 *
 * The expiry rule is the one worth pinning: a card is good until the **end** of
 * its month, so the obvious comparison — is this month past the card's month? —
 * marks a perfectly working card dead for up to thirty days and tells its owner
 * to replace it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { cardBrandLabel, cardExpiry } from "./saved-cards.ts";

test("a card is still good on the last day of the month it expires", () => {
  const card = { exp_month: 4, exp_year: 2031 };
  assert.equal(cardExpiry(card, new Date(2031, 3, 30, 23, 0)).expired, false);
  // The first instant of the next month is the first instant it is dead.
  assert.equal(cardExpiry(card, new Date(2031, 4, 1)).expired, true);
});

test("a card from a past year is expired, and one from a future year is not", () => {
  assert.equal(cardExpiry({ exp_month: 12, exp_year: 2020 }, new Date(2026, 0, 1)).expired, true);
  assert.equal(cardExpiry({ exp_month: 1, exp_year: 2040 }, new Date(2026, 0, 1)).expired, false);
});

test("the expiry is padded to the shape printed on the card", () => {
  assert.equal(cardExpiry({ exp_month: 4, exp_year: 2031 }).label, "04/31");
  assert.equal(cardExpiry({ exp_month: 11, exp_year: 2029 }).label, "11/29");
});

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
