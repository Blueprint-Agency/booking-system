/**
 * Who may take a trial, per Entity and per Trial Type. A trial is a package of
 * its parent's kind with the trial box ticked — a credit bundle, an Unlimited
 * pass, a 1-on-1 or a 2-on-1 package — and it is for a member new to that type
 * in its Entity: one per type per Entity, ever, and none once they hold or held
 * a package of that type there. The server decides (the catalogue's
 * `trial_by_entity_type`); this reads that answer for one trial and words it.
 */

/** What a trial is a first taste of: group classes, or a private session type. */
export type TrialType = "group" | "1on1" | "2on1";

export interface TrialStanding {
  /** The member has held a trial of this type in this Entity. */
  used: boolean;
  /** The member is new to this type in this Entity: a trial is for them. */
  eligible: boolean;
}

type WireStanding = { trial_used: boolean; trial_eligible: boolean };

/** The trial facts of the catalogue's entitlements, as the server sends them. */
export interface TrialEntitlements {
  /** Across every Entity: any trial held. What an older server sends alone. */
  trial_used: boolean;
  /** Across every Entity: no package held. */
  trial_eligible: boolean;
  /** By Entity id, the group-class trial; absent from a server that does not know Entities yet. */
  trial_by_entity?: Record<string, WireStanding>;
  /** By Entity id and then Trial Type; absent from a server from before PT trials. */
  trial_by_entity_type?: Record<string, Partial<Record<TrialType, WireStanding>>>;
}

/**
 * The standing for a trial of `type` in `entityId`. Signed out (no
 * entitlements) every trial reads open: the sign-in gate runs on the click. An
 * older server's answers are read as far as they go: its per-Entity pair is the
 * group trial's, and its studio-wide pair the last word.
 */
export function trialStandingFor(
  entitlements: TrialEntitlements | null,
  entityId: string | null | undefined,
  type: TrialType,
): TrialStanding {
  if (!entitlements) return { used: false, eligible: true };
  const byType = entityId ? entitlements.trial_by_entity_type?.[entityId]?.[type] : undefined;
  if (byType) return { used: byType.trial_used, eligible: byType.trial_eligible };
  const group = entityId && type === "group" ? entitlements.trial_by_entity?.[entityId] : undefined;
  if (group) return { used: group.trial_used, eligible: group.trial_eligible };
  return { used: entitlements.trial_used, eligible: entitlements.trial_eligible };
}

/** The label on a trial's button when it is closed to the member. */
export function trialClosedLabel(standing: TrialStanding): string {
  return standing.used ? "Not eligible" : "New members only";
}

const TRIAL_NOUN: Record<TrialType, string> = {
  group: "group class trial",
  "1on1": "1-on-1 trial",
  "2on1": "2-on-1 trial",
};
const NEW_TO: Record<TrialType, string> = {
  group: "group classes",
  "1on1": "1-on-1 sessions",
  "2on1": "2-on-1 sessions",
};

/**
 * The sentence for a trial the member cannot take, shown above the packages
 * beside it. `entityName` is given when the page shows trials of more than one
 * Entity, so the member can tell which it means; at a studio with one it is
 * null and the sentence is the plain one.
 */
export function trialClosedText(used: boolean, entityName: string | null, type: TrialType): string {
  const noun = entityName ? `${entityName} ${TRIAL_NOUN[type]}` : TRIAL_NOUN[type];
  if (used) return `You've used your ${noun}. The other packages here are yours to buy.`;
  const where = entityName ? ` at ${entityName}` : "";
  return `The ${noun} is for members new to ${NEW_TO[type]}${where}. The other packages here are yours to buy.`;
}
