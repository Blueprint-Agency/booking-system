/**
 * How a card's brand reads to the member who paid with it (#185).
 *
 * Nothing here is a card number. The brand, the last four digits and the expiry
 * are the whole of what this app ever sees — exactly enough for a member to
 * tell their own cards apart, and nothing a thief could use.
 */

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
