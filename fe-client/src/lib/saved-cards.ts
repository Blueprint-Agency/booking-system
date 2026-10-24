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
