// The ClassPass page (be-portal.md §classpass.ts, #409): the studio's
// ClassPass address, its import switch, Gmail's confirmation code, and what
// has arrived. Shapes mirror be/src/routes/portal/admin/classpass.ts.

import type { Api } from "@/lib/api";

export type ClassPassOutcome =
  | "imported"
  | "cancelled"
  | "noop"
  | "ignored"
  | "refused"
  | "unparsed"
  | "review";

export interface ClassPassStatus {
  /** Null where the deployment has no inbound domain. */
  address: string | null;
  enabled: boolean;
  /** The code in Gmail's older forwarding confirmation. */
  gmail_confirmation_code: string | null;
  /** Gmail's `https://mail-settings.google.com/mail/vf-…` link, which confirms forwarding when opened signed in to that Gmail. */
  gmail_confirmation_link: string | null;
  gmail_confirmation_at: string | null;
  last_received_at: string | null;
  counts: Record<ClassPassOutcome, number>;
  /** ClassPass bookings in an Overbook seat on a class that hasn't ended, soonest first. */
  overbooked: ClassPassOverbooked[];
  /** The ClassPass Daily Roster check (#415) over the last week's rosters. */
  roster_check: ClassPassRosterCheck;
  /** What the setup guide ticks each step on. */
  setup: ClassPassSetup;
}

/** The setup guide's facts, worked out by the backend from what the studio has done and what has arrived. */
export interface ClassPassSetup {
  enabled: boolean;
  /** Gmail's forwarding confirmation arrived, with a code or a confirmation link. */
  gmail_confirmation_received: boolean;
  gmail_confirmation_at: string | null;
  /** The first trusted email ClassPass sent (any kind, a Daily Roster included); null before one. */
  first_classpass_email_at: string | null;
  location_mappings: number;
  /** Open review items waiting on a ClassPass location nobody has mapped. */
  unmapped_location_reviews: number;
  /** The first ClassPass booking made, cancelled since or not; null before one. */
  first_classpass_booking_at: string | null;
}

export type SetupStepKey = "enable" | "forwarding" | "filter" | "locations" | "test_booking";

export interface SetupStep {
  key: SetupStepKey;
  done: boolean;
  /** `current` is the first step not done; the ones after it stay readable, as `upcoming`. */
  state: "done" | "current" | "upcoming";
}

/**
 * Gmail's confirmation link, to open, only when it is a link to Gmail's
 * forwarding settings (as the backend keeps it); null otherwise.
 */
export function gmailConfirmationHref(link: string | null): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" && url.hostname === "mail-settings.google.com" && url.pathname.startsWith("/mail/vf-")
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** How often the page asks for news while a step is still to be done. */
export const SETUP_POLL_MS = 10_000;

/**
 * The setup guide, step by step, from the facts the status carries: which
 * steps are done, which is the one to do now, and whether the page should keep
 * asking until every step has ticked.
 */
export function setupGuide(setup: ClassPassSetup): {
  steps: SetupStep[];
  current: SetupStepKey | null;
  complete: boolean;
  poll: boolean;
} {
  const facts: [SetupStepKey, boolean][] = [
    ["enable", setup.enabled],
    ["forwarding", setup.gmail_confirmation_received],
    ["filter", setup.first_classpass_email_at !== null],
    ["locations", setup.location_mappings > 0 && setup.unmapped_location_reviews === 0],
    ["test_booking", setup.first_classpass_booking_at !== null],
  ];
  const current = facts.find(([, done]) => !done)?.[0] ?? null;
  const steps = facts.map(([key, done]): SetupStep => ({
    key,
    done,
    state: done ? "done" : key === current ? "current" : "upcoming",
  }));
  return { steps, current, complete: current === null, poll: current !== null };
}

export type RosterDifferenceKind = "on_classpass_not_on_roster" | "on_roster_not_on_classpass";

export interface ClassPassRosterDifference {
  difference: RosterDifferenceKind;
  /** Null when no class at the Location and time is the one the roster lists. */
  class_id: string | null;
  class_name: string;
  starts_at: string;
  member_name: string;
  /** The ClassPass booking ClassPass doesn't list; null for a member we don't hold. */
  booking_id: string | null;
  roster_received_at: string;
}

export interface ClassPassRosterCheck {
  differences: ClassPassRosterDifference[];
  /** Rosters whose listing has no ClassPass location mapping, newest first. */
  unchecked: { location_name: string | null; received_at: string }[];
}

/**
 * What a roster difference means, in the page's words. "Roster" is our class
 * roster: ClassPass's Daily Roster is "ClassPass".
 */
export const ROSTER_DIFFERENCE_LABELS: Record<RosterDifferenceKind, string> = {
  on_classpass_not_on_roster: "On ClassPass, not on roster",
  on_roster_not_on_classpass: "On roster, not on ClassPass",
};

export interface ClassPassOverbooked {
  booking_id: string;
  class_id: string;
  class_name: string;
  starts_at: string;
  client_name: string;
}

/** The flag over the list of ClassPass bookings that took an Overbook seat. */
export function overbookedHeadline(overbooked: ClassPassOverbooked[]): string {
  const n = overbooked.length;
  return n === 1
    ? "1 ClassPass booking took an Overbook seat on an upcoming class."
    : `${n} ClassPass bookings took an Overbook seat on upcoming classes.`;
}

/** The sender a studio's Gmail filter forwards. */
export const CLASSPASS_SENDER = "noreply@info.classpass.com";

/** In the order the page lists them, with the words it uses. */
export const OUTCOME_LABELS: { outcome: ClassPassOutcome; label: string }[] = [
  { outcome: "imported", label: "Imported" },
  { outcome: "cancelled", label: "Cancelled" },
  { outcome: "review", label: "For review" },
  { outcome: "unparsed", label: "Unreadable" },
  { outcome: "noop", label: "No change" },
  { outcome: "ignored", label: "Ignored" },
  { outcome: "refused", label: "Refused" },
];

/** Every outcome with its count (a missing count is 0), and the total received. */
export function outcomeRows(counts: Partial<Record<ClassPassOutcome, number>>): {
  rows: { outcome: ClassPassOutcome; label: string; count: number }[];
  total: number;
} {
  const rows = OUTCOME_LABELS.map(({ outcome, label }) => ({ outcome, label, count: counts[outcome] ?? 0 }));
  return { rows, total: rows.reduce((n, row) => n + row.count, 0) };
}

export function getClassPass(api: Api): Promise<ClassPassStatus> {
  return api.get<ClassPassStatus>("/portal/admin/classpass");
}

/** What a change to the page answers: the status without the roster check, which only a read works out. */
export type ClassPassSettings = Omit<ClassPassStatus, "roster_check">;

export function setClassPassEnabled(api: Api, enabled: boolean): Promise<ClassPassSettings> {
  return api.patch<ClassPassSettings>("/portal/admin/classpass", { enabled });
}

export function regenerateClassPassAddress(api: Api): Promise<ClassPassSettings> {
  return api.post<ClassPassSettings>("/portal/admin/classpass/address/regenerate");
}

// ClassPass location mappings (#410): ClassPass's name for a location -> one
// of the studio's Locations. The backend stores the name normalised
// (lower-cased, spaces collapsed, every dash `-`), so the list shows it so.

export interface ClassPassLocationMapping {
  id: string;
  location_name: string;
  location_id: string;
  location: { name: string; archived_at: string | null };
  created_at: string;
  updated_at: string;
}

/** The Locations a mapping may name: live ones, by name. */
export function mappableLocations(
  locations: { id: string; name: string; archivedAt: string | null }[],
): { id: string; name: string }[] {
  return locations
    .filter((l) => !l.archivedAt)
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listClassPassLocationMappings(api: Api): Promise<ClassPassLocationMapping[]> {
  const res = await api.get<{ mappings: ClassPassLocationMapping[] }>("/portal/admin/classpass/locations");
  return res.mappings;
}

export function addClassPassLocationMapping(
  api: Api,
  input: { location_name: string; location_id: string },
): Promise<ClassPassLocationMapping> {
  return api.post<ClassPassLocationMapping>("/portal/admin/classpass/locations", input);
}

export function changeClassPassLocationMapping(
  api: Api,
  id: string,
  patch: { location_name?: string; location_id?: string },
): Promise<ClassPassLocationMapping> {
  return api.patch<ClassPassLocationMapping>(`/portal/admin/classpass/locations/${id}`, patch);
}

export async function removeClassPassLocationMapping(api: Api, id: string): Promise<void> {
  await api.del(`/portal/admin/classpass/locations/${id}`);
}
