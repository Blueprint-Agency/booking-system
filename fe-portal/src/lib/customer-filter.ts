/**
 * The Customers page's filter pills and the `?filter=` address that selects
 * one. The bell links to `?filter=no_email`.
 */
export type CustomerFilter = "all" | "active" | "trials" | "blocked" | "no_email";

export const CUSTOMER_FILTER_LABEL: Record<CustomerFilter, string> = {
  all: "All",
  active: "Active",
  trials: "Trials",
  blocked: "Blocked",
  no_email: "No email",
};

/**
 * The Entity choice on the Trials filter. It belongs to Trials alone: the
 * address and the list read carry it only there, so leaving Trials cannot leave
 * a stale Entity behind. "" is every Entity.
 */
export function customerEntityFor(status: CustomerFilter, entityId: string | null | undefined): string {
  return status === "trials" && entityId ? entityId : "";
}

/** The Entity select shows under Trials, for a studio with two or more Entities; with one it would filter nothing. */
export function showCustomerEntityFilter(status: CustomerFilter, entityCount: number): boolean {
  return status === "trials" && entityCount >= 2;
}

/**
 * What the Trial Funnel says about the Entity it is read for: a heading naming
 * it ("Pilates trials") and the Converted tile's hint, which for an Entity means
 * paying for a package of that Entity. Unnamed, the studio-wide wording stays.
 */
export function trialFunnelCopy(entityName: string | null | undefined): { heading: string | null; convertedHint: string } {
  if (!entityName) return { heading: null, convertedHint: "Went on to pay for a package" };
  return { heading: `${entityName} trials`, convertedHint: `Went on to pay for a ${entityName} package` };
}

/** The filter a `?filter=` value names; anything else is the whole list. */
export function parseCustomerFilter(value: string | null): CustomerFilter {
  return value === "active" || value === "trials" || value === "blocked" || value === "no_email" ? value : "all";
}
