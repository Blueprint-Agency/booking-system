/**
 * A card the member has kept, and how it reads to them.
 *
 * Nothing here is a card number: the brand, the last four digits and the expiry
 * are the whole of what this app ever sees, which is enough to tell one's own
 * cards apart and nothing a thief could use. No React and no API client, so
 * `node --test` can load it; fetching is `use-saved-cards.ts`.
 */

export interface SavedCard {
  /** The payment provider's id for the card, which is what Remove names. */
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
}

/** The networks the provider names, as a member says them. `unknown` is the provider's word for a card it cannot place. */
const CARD_BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  unionpay: "UnionPay",
  jcb: "JCB",
  discover: "Discover",
  diners: "Diners Club",
  eftpos_au: "EFTPOS",
  unknown: "Card",
};

/** `visa` as the provider writes it, `Visa` as a member reads it. */
export function cardBrandLabel(brand: string): string {
  // A network nobody wrote down is still named, in words rather than the
  // provider's snake_case, so a member never faces a card with no name on it.
  const spoken = brand.replaceAll("_", " ").trim();
  return CARD_BRANDS[brand] ?? (spoken === "" ? "Card" : spoken.charAt(0).toUpperCase() + spoken.slice(1));
}

/**
 * `4 / 2031` as `04/31`, and whether it has already passed. A card is good to
 * the end of its month, so it is dead from the first instant of the month
 * after: comparing the months instead would call a working card expired for up
 * to thirty days.
 */
export function cardExpiry(
  card: Pick<SavedCard, "exp_month" | "exp_year">,
  now = new Date(),
): { label: string; expired: boolean } {
  const label = `${String(card.exp_month).padStart(2, "0")}/${String(card.exp_year).slice(-2)}`;
  // The constructor's month is zero-based, so the one-based expiry month is
  // already the month after.
  return { label, expired: now >= new Date(card.exp_year, card.exp_month, 1) };
}

/**
 * Where the read of the member's cards stands. An empty list and a failed read
 * are different states: drawing the second as the first would tell a member
 * with a card on file that they have none.
 */
export type CardsRead = { status: "loading" } | { status: "failed" } | { status: "loaded"; cards: SavedCard[] };

/** What the section draws for a read. `empty` only ever follows a read that succeeded. */
export function cardsView(read: CardsRead): "loading" | "failed" | "empty" | "list" {
  if (read.status !== "loaded") return read.status;
  return read.cards.length === 0 ? "empty" : "list";
}

/** The read with one card taken out; a read that has no list is left as it is. */
export function cardsAfterRemoval(read: CardsRead, cardId: string): CardsRead {
  if (read.status !== "loaded") return read;
  return { status: "loaded", cards: read.cards.filter((card) => card.id !== cardId) };
}

/**
 * Whether a card is still on the list a fresh read returned: `null` when that
 * read failed too, so the member is not told something nobody checked.
 */
export function cardStillSaved(cards: SavedCard[] | null, cardId: string): boolean | null {
  return cards === null ? null : cards.some((card) => card.id === cardId);
}

/**
 * Said when a remove failed. "It's still saved" is said only once a fresh read
 * has shown the card there (`stillSaved: true`); without that read the request
 * may have gone through, so the card "may still be saved". `reason` is the
 * server's own sentence, shown in place of the generic one.
 */
export function removeCardMessage(
  card: Pick<SavedCard, "brand" | "last4">,
  failure: { stillSaved: boolean | null; reason?: string },
): string {
  const state = failure.stillSaved === true ? "It's still saved." : "It may still be saved.";
  return `Couldn't remove ${cardBrandLabel(card.brand)} ending ${card.last4}. ${state} ${failure.reason ?? "Please try again."}`;
}

/** Said, politely, once a card has been removed. */
export function removedCardAnnouncement(card: Pick<SavedCard, "brand" | "last4">): string {
  return `${cardBrandLabel(card.brand)} ending ${card.last4} removed.`;
}
