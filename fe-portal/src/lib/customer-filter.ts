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

/** The filter a `?filter=` value names; anything else is the whole list. */
export function parseCustomerFilter(value: string | null): CustomerFilter {
  return value === "active" || value === "trials" || value === "blocked" || value === "no_email" ? value : "all";
}
