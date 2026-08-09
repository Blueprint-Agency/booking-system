// The portal's catalog surface: instructors, rooms, locations and class types.
// Shapes mirror be/src/routes/portal/admin/{instructors,rooms,locations,class-types}.ts.
//
// Every read here returns *active* rows only, and that is the whole point of the
// module: the backend already drops archived rooms, locations and class types,
// but `GET /portal/admin/instructors` returns archived instructors unless a
// status filter is passed. Six screens used to re-type `!i.archived_at` and one
// forgot to. So the rows returned here deliberately carry no `archived_at` —
// there is nothing left for a caller to filter on.
//
// Takes the backend handle as a parameter rather than reaching for React
// context, following `ManualPayrollDialog` — which also makes these callable
// without a Clerk session.

import type { Api } from "@/lib/api";

export interface CatalogInstructor {
  id: string;
  name: string;
}

export interface CatalogRoom {
  id: string;
  location_id: string;
  name: string;
}

export interface CatalogLocation {
  id: string;
  name: string;
}

export interface CatalogClassType {
  id: string;
  name: string;
}

/**
 * Instructors that are not archived — including pending invitees, who are
 * schedulable. Filtered here rather than via `?status=active`, which would drop
 * the pending ones.
 */
export async function fetchActiveInstructors(api: Api): Promise<CatalogInstructor[]> {
  const res = await api.get<{
    instructors: Array<CatalogInstructor & { archived_at: string | null }>;
  }>("/portal/admin/instructors");
  return res.instructors.filter((i) => !i.archived_at);
}

/** Rooms across all locations; archived ones are excluded by the backend. */
export async function fetchActiveRooms(api: Api): Promise<CatalogRoom[]> {
  const res = await api.get<{ rooms: CatalogRoom[] }>("/portal/admin/rooms");
  return res.rooms;
}

/** Locations; archived ones are excluded by the backend. */
export async function fetchActiveLocations(api: Api): Promise<CatalogLocation[]> {
  const res = await api.get<{ locations: CatalogLocation[] }>("/portal/admin/locations");
  return res.locations;
}

/** Class types; archived ones are excluded by the backend. */
export async function fetchActiveClassTypes(api: Api): Promise<CatalogClassType[]> {
  const res = await api.get<{ class_types: CatalogClassType[] }>(
    "/portal/admin/class-types",
  );
  return res.class_types;
}
