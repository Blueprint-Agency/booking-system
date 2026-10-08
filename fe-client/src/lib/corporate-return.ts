/**
 * Where a member lands once a corporate package is bought, and what that
 * landing carries (fe-client-features §6.2).
 *
 * A corporate package is paid for through the normal checkout, and the payment
 * makes the member's one pending Corporate Request — there is no request form.
 * The member lands on their corporate bookings, told the request is in, with
 * the studio's WhatsApp button. The backend sends a paid checkout back to the
 * same address with the provider's `session_id`; a package with nothing to pay
 * arrives without one.
 *
 * Pure, so it is testable without a browser.
 */

/** The landing for a corporate package just bought, before any payment session is known. */
export function corporateRequestSentHref(packageId: string): string {
  const query = new URLSearchParams({ type: "corporate", submitted: "corporate", package_id: packageId });
  return `/account/bookings?${query.toString()}`;
}

/** What a landing on "Your bookings" says about a corporate package just bought, or null. */
export function corporateArrival(
  params: URLSearchParams,
): { packageId: string | null; sessionId: string | null } | null {
  if (params.get("submitted") !== "corporate") return null;
  return {
    packageId: params.get("package_id") || null,
    sessionId: params.get("session_id") || null,
  };
}
