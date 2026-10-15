/**
 * Where checkout's Bill to stands (#401), and what the Pay button says while
 * it waits on it. The picker reports its status; the page holds Pay until a
 * set is chosen and names why, so a member whose saved sets failed to load is
 * told to try again, not to add a set they already have.
 *
 * Pure, so it is testable without a browser.
 */
export type BillToStatus = "loading" | "failed" | "ready";

/** Pay's label while Bill to holds it, or null once a set is chosen. */
export function billToPayLabel(status: BillToStatus, chosen: boolean): string | null {
  if (chosen) return null;
  if (status === "loading") return "Loading your billing details…";
  if (status === "failed") return "We couldn't load your billing details. Try again above";
  return "Add your billing details to continue";
}
