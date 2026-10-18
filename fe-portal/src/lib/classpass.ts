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
  gmail_confirmation_code: string | null;
  gmail_confirmation_at: string | null;
  last_received_at: string | null;
  counts: Record<ClassPassOutcome, number>;
  /** ClassPass bookings in an Overbook seat on a class that hasn't ended, soonest first. */
  overbooked: ClassPassOverbooked[];
  /** The ClassPass Daily Roster check (#415) over the last week's rosters. */
  roster_check: ClassPassRosterCheck;
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

export function setClassPassEnabled(api: Api, enabled: boolean): Promise<ClassPassStatus> {
  return api.patch<ClassPassStatus>("/portal/admin/classpass", { enabled });
}

export function regenerateClassPassAddress(api: Api): Promise<ClassPassStatus> {
  return api.post<ClassPassStatus>("/portal/admin/classpass/address/regenerate");
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
