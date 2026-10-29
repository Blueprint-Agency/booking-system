import type { Location } from "@/types";

/**
 * Where the studio's *full* list of locations stands.
 *
 * The workspace holds two lists apart. The short one comes with the signed-in
 * staff payload: names and addresses, never a phone number or a Maps link, and
 * enough to choose a workspace. The full one is the admin locations read, with
 * every field and the archived rows, and it is the only list a screen may edit a
 * location from: a row taken from the short list saves a blank phone and Maps
 * link over the real ones.
 *
 * `idle` is for staff who do not run the studio and never read the full list.
 */
export type FullListStatus = "idle" | "loading" | "loaded" | "failed";

/** An admin may edit, archive or restore a location only from the loaded full list. */
export function mayEditLocations(status: FullListStatus): boolean {
  return status === "loaded";
}

/** The rows a screen that edits locations shows: the full list, or none. */
export function locationsToManage(
  status: FullListStatus,
  full: Location[] | null,
): Location[] {
  return mayEditLocations(status) && full ? full : [];
}

/**
 * The locations everything else reads, the workspace switcher among them: the
 * full list once it is there, the short one until then (choosing a workspace
 * needs only names).
 */
export function workspaceLocations(
  short: Location[],
  full: Location[] | null,
): Location[] {
  return full ?? short;
}

/** Throws unless `loc` is a location the full list gave. The update helper's guard. */
export function assertLoadedInFull(full: Location[] | null, loc: Location): void {
  if (!full || !full.some((l) => l.id === loc.id)) {
    throw new Error(
      "This location was not loaded in full, so it cannot be saved: reload the full list first.",
    );
  }
}
