/**
 * Who may take a trial pass, per Entity. A trial is for a member new to its
 * Entity: one per Entity, ever, and none once they hold or held any package
 * of it. The server decides (the catalogue's `trial_by_entity`, keyed by Entity
 * id); this reads that answer for one trial and words it.
 */

export interface TrialStanding {
  /** The member has held a trial in this Entity. */
  used: boolean;
  /** The member is new to this Entity: a trial is for them. */
  eligible: boolean;
}

/** The trial facts of the catalogue's entitlements, as the server sends them. */
export interface TrialEntitlements {
  /** Across every Entity: any trial held. What an older server sends alone. */
  trial_used: boolean;
  /** Across every Entity: no package held. */
  trial_eligible: boolean;
  /** By Entity id; absent from a server that does not know Entities yet. */
  trial_by_entity?: Record<string, { trial_used: boolean; trial_eligible: boolean }>;
}

/**
 * The standing for a trial in `entityId`. Signed out (no entitlements) every
 * trial reads open: the sign-in gate runs on the click. A trial whose Entity the
 * server did not list falls back to its studio-wide pair, which at a studio with
 * one Entity is the same answer.
 */
export function trialStandingFor(
  entitlements: TrialEntitlements | null,
  entityId: string | null | undefined,
): TrialStanding {
  if (!entitlements) return { used: false, eligible: true };
  const here = entityId ? entitlements.trial_by_entity?.[entityId] : undefined;
  if (here) return { used: here.trial_used, eligible: here.trial_eligible };
  return { used: entitlements.trial_used, eligible: entitlements.trial_eligible };
}

/** The label on a trial's button when it is closed to the member. */
export function trialClosedLabel(standing: TrialStanding): string {
  return standing.used ? "Not eligible" : "New members only";
}

/**
 * The sentence for a trial the member cannot take. `entityName` is given when
 * the page shows trials of more than one Entity, so the member can tell which
 * it means; at a studio with one it is null and the sentence is the plain one.
 */
export function trialClosedText(used: boolean, entityName: string | null): string {
  if (used) {
    return entityName
      ? `You've used your ${entityName} trial pass. See its credit bundles or Unlimited to keep booking.`
      : "You've used your trial pass. See credit bundles or Unlimited to keep booking.";
  }
  return entityName
    ? `The ${entityName} trial pass is for members new to ${entityName}. See its credit bundles or Unlimited instead.`
    : "The trial pass is for new members only. See credit bundles or Unlimited instead.";
}

/** The shorter sentence a refused purchase shows, by the server's code. */
export function trialRefusalText(
  code: "trial_already_used" | "trial_not_eligible",
  entityName: string | null,
): string {
  if (code === "trial_already_used") {
    return entityName
      ? `You've already used your ${entityName} trial pass.`
      : "You've already used your trial pass.";
  }
  return entityName
    ? `The ${entityName} trial pass is for members new to ${entityName}.`
    : "The trial pass is for new members only.";
}
