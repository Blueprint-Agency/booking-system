"use client";
import { useEffect, useMemo } from "react";
import { Label } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import type { CatalogRoom } from "@/lib/catalog";

/**
 * The location and room pickers for a scheduled event, as two grid cells — the
 * caller owns the surrounding grid.
 *
 * A room belongs to exactly one location, so the two can never be picked
 * independently: the room list is filtered to the chosen location and a room
 * that no longer belongs to it is cleared, rather than left to be refused by the
 * backend as `room_location_mismatch`. The location list is the staff member's
 * accessible locations, minus archived ones.
 *
 * What is deliberately NOT a caller: the PT scheduling dialog. It auto-selects
 * the first room of the chosen location instead of clearing the pick, and
 * unifying it would silently change which room a session gets booked into.
 */

const SELECT_CLASS =
  "flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";

export function LocationRoomFields({
  idPrefix,
  rooms,
  locationId,
  roomId,
  onLocationChange,
  onRoomChange,
  disabled = false,
  locationLabel = "Location",
  roomOptional = false,
}: {
  /** Prefixes both field ids, so several editors can share a page. */
  idPrefix: string;
  /** Rooms across every location — this filters them. */
  rooms: CatalogRoom[];
  locationId: string;
  roomId: string;
  onLocationChange: (id: string) => void;
  onRoomChange: (id: string) => void;
  disabled?: boolean;
  /** Corporate calls its studios "Studio" to contrast with an off-site venue. */
  locationLabel?: string;
  /** Corporate sessions can run without a room; every other kind needs one. */
  roomOptional?: boolean;
}) {
  const { accessibleLocations } = useWorkspace();

  const activeLocations = useMemo(
    () => accessibleLocations.filter((l) => !l.archivedAt),
    [accessibleLocations],
  );
  const roomsForLocation = useMemo(
    () => rooms.filter((r) => r.location_id === locationId),
    [rooms, locationId],
  );

  // Clear the selected room if it no longer belongs to the chosen location.
  useEffect(() => {
    if (roomId && !roomsForLocation.some((r) => r.id === roomId)) onRoomChange("");
  }, [roomId, roomsForLocation, onRoomChange]);

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-loc`}>{locationLabel}</Label>
        <select
          id={`${idPrefix}-loc`}
          value={locationId}
          required
          disabled={disabled}
          onChange={(e) => onLocationChange(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">Select…</option>
          {activeLocations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-room`}>
          {roomOptional ? "Room (optional)" : "Room"}
        </Label>
        <select
          id={`${idPrefix}-room`}
          value={roomId}
          required={!roomOptional}
          disabled={disabled || !locationId}
          onChange={(e) => onRoomChange(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">
            {!locationId
              ? `Pick a ${locationLabel.toLowerCase()} first`
              : roomOptional
                ? "No room"
                : "Select…"}
          </option>
          {roomsForLocation.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
