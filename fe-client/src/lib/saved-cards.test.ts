import test from "node:test";
import assert from "node:assert/strict";
import {
  cardBrandLabel,
  cardExpiry,
  cardStillSaved,
  cardsAfterRemoval,
  cardsView,
  removeCardMessage,
  removedCardAnnouncement,
  type CardsRead,
  type SavedCard,
} from "./saved-cards.ts";

const visa: SavedCard = { id: "pm_visa", brand: "visa", last4: "4242", exp_month: 4, exp_year: 2031 };
const amex: SavedCard = { id: "pm_amex", brand: "amex", last4: "0005", exp_month: 11, exp_year: 2029 };

test("PAY-76 a card reads as its brand, last four and expiry: a brand nobody wrote down is still named, an expiry is padded to the card's shape, and a card is good through the last day of its month", () => {
  assert.equal(cardBrandLabel("visa"), "Visa");
  assert.equal(cardBrandLabel("amex"), "American Express");
  // A code nobody wrote down is spoken, not spelled: no underscores, and the
  // provider's "unknown" is just a card.
  assert.equal(cardBrandLabel("cartes_bancaires"), "Cartes bancaires");
  assert.equal(cardBrandLabel("unknown"), "Card");
  assert.equal(cardBrandLabel("eftpos_au"), "EFTPOS");

  assert.equal(cardExpiry({ exp_month: 4, exp_year: 2031 }).label, "04/31");
  assert.equal(cardExpiry({ exp_month: 11, exp_year: 2029 }).label, "11/29");

  const card = { exp_month: 4, exp_year: 2031 };
  assert.equal(cardExpiry(card, new Date(2031, 3, 30, 23, 0)).expired, false);
  assert.equal(cardExpiry(card, new Date(2031, 4, 1)).expired, true);
});

test("PAY-77 the Saved cards section says there are none only when the read succeeded and returned none, never for a read still loading or one that failed", () => {
  const loading: CardsRead = { status: "loading" };
  const failed: CardsRead = { status: "failed" };
  assert.equal(cardsView(loading), "loading");
  assert.equal(cardsView(failed), "failed");
  assert.equal(cardsView({ status: "loaded", cards: [] }), "empty");
  assert.equal(cardsView({ status: "loaded", cards: [visa] }), "list");
});

test("PAY-78 a removed card leaves the list and the other stays, while a read that is loading or failed is not turned into a list by it", () => {
  const loaded: CardsRead = { status: "loaded", cards: [visa, amex] };
  assert.deepEqual(cardsAfterRemoval(loaded, "pm_visa"), { status: "loaded", cards: [amex] });
  assert.deepEqual(cardsAfterRemoval(loaded, "pm_unknown"), loaded);
  assert.deepEqual(cardsAfterRemoval({ status: "loaded", cards: [visa] }, "pm_visa"), { status: "loaded", cards: [] });
  assert.deepEqual(cardsAfterRemoval({ status: "failed" }, "pm_visa"), { status: "failed" });
  assert.deepEqual(cardsAfterRemoval({ status: "loading" }, "pm_visa"), { status: "loading" });
});

test("PAY-78 a failed remove names the card and says it is still saved only once a fresh read has confirmed it, otherwise that it may still be saved", () => {
  const confirmed = removeCardMessage(visa, { stillSaved: true });
  assert.match(confirmed, /Visa/);
  assert.match(confirmed, /4242/);
  assert.match(confirmed, /It's still saved\./);
  assert.match(confirmed, /Please try again\./);

  const unsure = removeCardMessage(visa, { stillSaved: null });
  assert.match(unsure, /may still be saved/i);
  assert.doesNotMatch(unsure, /It's still saved/);
});

test("PAY-78 a failed remove shows the server's own sentence in place of Please try again", () => {
  const text = removeCardMessage(visa, { stillSaved: true, reason: "This studio isn't taking card payments." });
  assert.match(text, /This studio isn't taking card payments\./);
  assert.doesNotMatch(text, /Please try again/);
});

test("PAY-78 a removed card is announced by its brand and last four", () => {
  assert.equal(removedCardAnnouncement(visa), "Visa ending 4242 removed.");
  assert.equal(removedCardAnnouncement({ brand: "unknown", last4: "0001" }), "Card ending 0001 removed.");
});

test("PAY-78 after a failed remove, a fresh read says whether the card is still listed, and nothing when the read failed too", () => {
  assert.equal(cardStillSaved([visa, amex], "pm_visa"), true);
  assert.equal(cardStillSaved([amex], "pm_visa"), false);
  assert.equal(cardStillSaved(null, "pm_visa"), null);
});
