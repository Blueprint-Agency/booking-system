/**
 * The Book sheet's package picker: which of the member's class packages pays
 * for a class (be/docs/adr/0010).
 *
 * Several class packages may run at once and the member picks the one that
 * pays. The backend decides everything that matters — which packages are
 * Eligible for this class, why the others are not, and which one is the
 * Default payer — and states it on `GET /me/classes/:id`. What lives here is
 * what the sheet makes of that: which row starts ticked, and the words each
 * row and the cost line say. Pure, so each can be tested against the payload
 * that produces it.
 */
import { notAcceptedCopy, notCoveredCopy, planRunsOutCopy } from "./booking-copy.ts";
import { formatExpiryDate } from "./utils.ts";

/**
 * Why a package cannot pay for this class — `SelectionRefusal` in the backend.
 * `not_accepted`: the class's Package rule does not take it (package-rule.ts).
 */
export type PackageRefusal =
  | "not_accepted"
  | "location_not_covered"
  | "plan_expires_before_class"
  | "insufficient_credits";

/** One row of `my_packages` on `GET /me/classes/:id`, in default order. */
export interface MyClassPackage {
  id: string;
  name: string;
  kind: "credit_bundle" | "unlimited" | "trial";
  /** Activated: its clock is running. False means Dormant. */
  running: boolean;
  /** Credits left; null on an Unlimited Plan. */
  remaining: number | null;
  expires_at: string | null;
  /** Dormant only: the end date picking it for this class would stamp. */
  activation_end_if_picked: string | null;
  /** An Unlimited Plan's Home Location; null for every other kind. */
  location: { id: string; name: string } | null;
  eligible: boolean;
  reason: PackageRefusal | null;
}

/** What the picker reads off the class detail. */
export interface PickerPayload {
  /** The Default payer: the package to pre-select. Null when nothing is Eligible. */
  default_client_package_id: string | null;
  my_packages: MyClassPackage[];
}

export const credits = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;

/**
 * The row ticked when the sheet opens, so booking stays one tap: the Default
 * payer. It is the first Eligible row by the backend's own ordering; should the
 * two ever disagree, a row that can actually pay wins over one that cannot.
 */
export function initialPick(payload: PickerPayload): string | null {
  const byDefault = payload.my_packages.find((p) => p.id === payload.default_client_package_id);
  if (byDefault?.eligible) return byDefault.id;
  return payload.my_packages.find((p) => p.eligible)?.id ?? null;
}

/** The short reason under a greyed row. Null for an Eligible one. */
export function reasonText(pkg: MyClassPackage): string | null {
  if (pkg.eligible || !pkg.reason) return null;
  switch (pkg.reason) {
    case "not_accepted":
      return "Not accepted for this class";
    case "location_not_covered":
      return pkg.location ? `Covers ${pkg.location.name} only` : "Doesn't cover this studio";
    case "plan_expires_before_class":
      return "Ends before this class";
    case "insufficient_credits":
      return "Not enough credits";
  }
}

/**
 * A Dormant pick starts its clock with this booking, so the sheet says the end
 * date it would get. Null for a running package, which already has one.
 */
export function activationLine(pkg: MyClassPackage): string | null {
  if (pkg.running || !pkg.activation_end_if_picked) return null;
  return `Starts today, runs until ${formatExpiryDate(pkg.activation_end_if_picked)}`;
}

/** What a row states about itself: its balance, and where its clock stands. */
export function packageMeta(pkg: MyClassPackage): string {
  const balance =
    pkg.kind === "unlimited"
      ? pkg.location
        ? `Unlimited at ${pkg.location.name}`
        : "Unlimited"
      : `${credits(pkg.remaining ?? 0)} left`;
  const clock = pkg.running
    ? pkg.expires_at
      ? `until ${formatExpiryDate(pkg.expires_at)}`
      : null
    : "not started yet";
  return clock ? `${balance} · ${clock}` : balance;
}

/** The cost line, read from the picked package. */
export function costLine(pkg: MyClassPackage | null, creditCost: number): string {
  if (pkg?.kind === "unlimited") return "Covered by your Unlimited plan";
  return `Uses ${credits(creditCost)}`;
}

/**
 * Why nothing can be booked, when no row is Eligible: the same refusal the
 * server would give — the first row's reason in default order, passing over
 * rows the class does not accept, since what is wrong with an accepted one is
 * what the member can fix (`refusalOf` in be/src/services/packages/selection.ts).
 * `not_accepted` only when no row is accepted. Null while at least one row can pay.
 */
export function nothingEligibleCopy(packages: MyClassPackage[]): string | null {
  if (packages.some((p) => p.eligible)) return null;
  if (packages.length === 0) return "You don't have a class package that can pay for this class.";
  const first = packages.find((p) => p.reason !== "not_accepted");
  if (!first) return notAcceptedCopy();
  switch (first.reason) {
    case "location_not_covered":
      return notCoveredCopy(first.location?.name ?? null);
    case "plan_expires_before_class":
      return planRunsOutCopy();
    default:
      return "You don't have enough credits for this class.";
  }
}

/**
 * The member holds class packages and the class takes none of them: nothing
 * they already have can book it, so the row stops offering Book. False with
 * no packages at all — that is the "out of credits" state, not this one.
 */
export function acceptsNone(packages: MyClassPackage[]): boolean {
  return packages.length > 0 && packages.every((p) => p.reason === "not_accepted");
}

/** The member's live Unlimited Plans, as `unlimited_plans` on the entitlements states them. */
export interface UnlimitedPlanCoverage {
  id: string;
  location: { id: string; name: string };
  covers_both: boolean;
  running: boolean;
}

/**
 * The Location the schedule opens on for this member: the one their Unlimited
 * Plans are all homed at, when none of them carries the Add-On — the only
 * studio whose classes those plans can pay for. Null when there is no plan,
 * plans at several Locations, or a plan that Covers them all; the schedule then
 * opens on its first Location as for anyone else.
 */
export function planHomeLocationId(plans: UnlimitedPlanCoverage[] | null | undefined): string | null {
  const list = plans ?? [];
  if (list.length === 0 || list.some((p) => p.covers_both)) return null;
  const homes = new Set(list.map((p) => p.location.id));
  return homes.size === 1 ? list[0]!.location.id : null;
}

/**
 * Whether the member's Unlimited Plans leave this class's Location uncovered,
 * and the Add-On that would fix it. A commented mirror of `covers()` in
 * `be/src/services/packages/selection.ts`: a plan Covers a class at its Home
 * Location, or anywhere once it carries the Add-On. Presentation only; the
 * booking stays the enforcement.
 *
 * `planLocationName` is the one Location the plans are homed at, for "Your plan
 * covers X only" — null when they are homed at several. `addOnPlanId` is the
 * plan an Add-On is offered on: the first in the list (running first).
 */
export function planCoverage(
  plans: UnlimitedPlanCoverage[] | null | undefined,
  classLocationId: string | null,
): { notCovered: boolean; planLocationName: string | null; addOnPlanId: string | null } {
  const list = plans ?? [];
  const homes = [...new Set(list.map((p) => p.location.name))];
  const planLocationName = homes.length === 1 ? homes[0]! : null;
  if (list.length === 0 || !classLocationId) {
    return { notCovered: false, planLocationName, addOnPlanId: null };
  }
  const covered = list.some((p) => p.covers_both || p.location.id === classLocationId);
  return {
    notCovered: !covered,
    planLocationName,
    addOnPlanId: covered ? null : list.find((p) => !p.covers_both)?.id ?? null,
  };
}
