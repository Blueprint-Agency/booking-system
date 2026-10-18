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
