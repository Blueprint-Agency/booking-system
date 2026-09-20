/**
 * A card the member has kept, and how it reads to them (#185).
 *
 * Deliberately free of React and of the API client: these are the rules about
 * what a card *says*, and they are the part worth testing on their own. Fetching
 * lives next door in `use-saved-cards.ts`.
 *
 * Nothing here is a card number. The brand, the last four digits and the expiry
 * are the whole of what this app ever sees — exactly enough for a member to
 * tell their own cards apart, and nothing a thief could use.
 */

export interface SavedCard {
  /** The provider's id for the card — what "remove" names. Not a number. */
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
}

/** `visa` as the provider writes it, `Visa` as a member reads it. */
export function cardBrandLabel(brand: string): string {
  const known: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    amex: "American Express",
    unionpay: "UnionPay",
    jcb: "JCB",
    discover: "Discover",
    diners: "Diners Club",
  };
  // A network nobody wrote down is still shown, capitalised. A provider adding
  // one must not leave a member looking at a card with no name on it.
  return known[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

/**
 * `4 / 2031` as `04/31`, and whether it has already passed.
 *
 * A card is good until the **end** of its month, so the comparison is against
 * the first instant of the month after it. The obvious version — is this month
 * past the card's month? — marks a working card dead for up to thirty days and
 * tells its owner to replace it.
 */
export function cardExpiry(
  card: Pick<SavedCard, "exp_month" | "exp_year">,
  now = new Date(),
): { label: string; expired: boolean } {
  const label = `${String(card.exp_month).padStart(2, "0")}/${String(card.exp_year).slice(-2)}`;
  // `new Date(y, m, 1)` with `m` one-based already means the month after — the
  // constructor's month is zero-based, so no arithmetic is needed and none is
  // written, which is one fewer place to be off by one.
  const deadAfter = new Date(card.exp_year, card.exp_month, 1);
  return { label, expired: now >= deadAfter };
}
