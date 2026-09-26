/**
 * Where a package can be used, as its card's "Covers" row says it (#316).
 *
 * A Credit Bundle — and a Trial, which is one — works at every Location, so
 * its card carries one "All locations" chip, decided from the kind alone. An
 * Unlimited plan's chips name its Home Location (and any Add-On), which the
 * payload carries; a PT package says nothing about location.
 */

/** Every package kind a member surface shows: the shop's, plus PT on the Account. */
export type PackageKind = "credit_bundle" | "unlimited" | "trial" | "pt";

/** The same wording at a one-Location studio, so it never changes when a second opens. */
export const ALL_LOCATIONS = "All locations";

export function coversAllLocations(kind: PackageKind): boolean {
  return kind === "credit_bundle" || kind === "trial";
}
