import { refusalMessage } from "./refusal-message";
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

/**
 * The question asked before a location is archived: how many live Unlimited
 * Plans call it home (`count`), or that the count could not be read (`null`).
 * Null when nothing is stranded and nothing need be asked. An unread count is
 * never taken as 0: the admin is told, and may still archive.
 */
export function archiveWarning(count: number | null, locationName: string): string | null {
  if (count === null) {
    return (
      `Couldn't check whether any live Unlimited Plan calls ${locationName} home, ` +
      `so archiving it may strand members. Archive anyway?`
    );
  }
  if (count <= 0) return null;
  return (
    `${count} live Unlimited ${count === 1 ? "Plan calls" : "Plans call"} ` +
    `${locationName} home. Archiving it strands ` +
    `${count === 1 ? "that member" : "those members"}. Archive anyway?`
  );
}

/** What the update helper's guard throws,so the form can tell it from any other failure. */
export class LocationNotLoadedInFullError extends Error {
  constructor() {
    super(
      "This location was not loaded in full, so it cannot be saved. Retry loading the full list of locations, then edit it again.",
    );
    this.name = "LocationNotLoadedInFullError";
  }
}

/**
 * Throws unless the full list is loaded and `loc` is a location it gave. The
 * update helper's guard: a list that is re-reading or failed is no basis for a save.
 */
export function assertLoadedInFull(
  full: Location[] | null,
  status: FullListStatus,
  loc: Location,
): void {
  if (!mayEditLocations(status) || !full || !full.some((l) => l.id === loc.id)) {
    throw new LocationNotLoadedInFullError();
  }
}

/** What a refused location save shows: the guard's own sentence, else the API's, else the fallback. */
export function locationSaveRefusal(err: unknown, fallback: string): string {
  if (err instanceof LocationNotLoadedInFullError) return err.message;
  return refusalMessage(err, fallback);
}

/**
 * Tags each read of the full list so only the latest one lands. A read a newer
 * one has replaced, or a reset has cancelled, must change nothing: not the rows
 * and not the status, whether it succeeded or failed.
 */
export function latestRead() {
  let current = 0;
  return {
    begin: () => ++current,
    cancel: () => {
      current++;
    },
    isCurrent: (id: number) => id === current,
  };
}
