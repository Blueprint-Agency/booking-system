"use client";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { LocationRoomFields } from "@/components/schedule/location-room-fields";
import {
  InstructorOption,
  useInstructorsOnLeave,
} from "@/components/schedule/instructor-leave";
import { todayIso, currentHourTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import { scheduleErrorMessage } from "@/lib/schedule";
import {
  fetchActiveInstructors,
  fetchActiveRooms,
  type CatalogInstructor,
  type CatalogRoom,
} from "@/lib/catalog";
import type { CorporateRequest } from "@/types";

/**
 * Schedules a pending corporate request. Mirrors the PT
 * schedule-from-request-dialog, but drives instructor/location/room options
 * from the live admin catalog endpoints and POSTs to the corporate-requests
 * schedule endpoint. No class-type / slot pre-fill — corporate requests carry
 * no proposed slots.
 */
export function ScheduleFromCorporateRequestDialog({
  request,
  onClose,
  onScheduled,
}: {
  request: CorporateRequest;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const { api, activeLocationId } = useWorkspace();

  const [instructors, setInstructors] = useState<CatalogInstructor[]>([]);
  const [rooms, setRooms] = useState<CatalogRoom[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState(currentHourTime());
  const [endTime, setEndTime] = useState(currentHourTime(1));
  const [mainInstructorId, setMainInstructorId] = useState("");
  const [supportingInstructorIds, setSupportingInstructorIds] = useState<
    string[]
  >([]);
  const [locationId, setLocationId] = useState(activeLocationId ?? "");
  const [roomId, setRoomId] = useState("");
  // Default to the client's suggested off-site venue when they gave one; else a studio.
  const [locationMode, setLocationMode] = useState<"studio" | "custom">(
    request.preferredLocation ? "custom" : "studio",
  );
  const [customLocation, setCustomLocation] = useState(
    request.preferredLocation ?? "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const onLeave = useInstructorsOnLeave(date);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const [ins, rm] = await Promise.all([
          fetchActiveInstructors(api),
          fetchActiveRooms(api),
        ]);
        if (cancelled) return;
        setInstructors(ins);
        setRooms(rm);
      } catch {
        if (cancelled) return;
        setCatalogError("Failed to load instructors / rooms.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (activeLocationId && !locationId) setLocationId(activeLocationId);
  }, [activeLocationId, locationId]);

  const availableForSupporting = useMemo(
    () =>
      instructors.filter(
        (i) =>
          i.id !== mainInstructorId &&
          !supportingInstructorIds.includes(i.id),
      ),
    [instructors, mainInstructorId, supportingInstructorIds],
  );

  // Drop the main instructor from supporting if it gets selected as main.
  useEffect(() => {
    if (!mainInstructorId) return;
    setSupportingInstructorIds((prev) =>
      prev.filter((id) => id !== mainInstructorId),
    );
  }, [mainInstructorId]);

  const isCustomLocation = locationMode === "custom";
  const trimmedCustomLocation = customLocation.trim();
  const locationReady = isCustomLocation
    ? trimmedCustomLocation.length > 0
    : Boolean(locationId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!api) return;
    if (!mainInstructorId || !locationReady) return;
    if (!date || !startTime || !endTime) return;

    const startsAt = new Date(`${date}T${startTime}:00`);
    const endsAt = new Date(`${date}T${endTime}:00`);
    if (endsAt <= startsAt) {
      setSubmitError("End time must be after start time.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.post(
        `/portal/admin/corporate-requests/${request.id}/schedule`,
        {
          main_instructor_id: mainInstructorId,
          supporting_instructor_ids: supportingInstructorIds,
          // Studio location (with optional room) OR a free-text off-site venue.
          ...(isCustomLocation
            ? { location_text: trimmedCustomLocation }
            : {
                location_id: locationId,
                ...(roomId ? { room_id: roomId } : {}),
              }),
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
        },
      );
      onScheduled();
    } catch (err) {
      setSubmitError(scheduleErrorMessage(err, "Failed"));
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Schedule corporate session"
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="rounded-md bg-paper p-3 text-xs text-muted">
          <span className="font-medium text-ink">{request.client.name}</span>{" "}
          · {request.package.name}
        </div>

        {catalogError && (
          <div className="rounded-md border border-error/30 bg-error/5 p-3 text-xs text-error">
            {catalogError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input
              type="date"
              min={todayIso()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Main instructor</Label>
            <select
              value={mainInstructorId}
              onChange={(e) => setMainInstructorId(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              {instructors.map((i) => (
                <InstructorOption key={i.id} instructor={i} onLeave={onLeave} />
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Start time</Label>
            <Input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>End time</Label>
            <Input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
        </div>

        {/* Location: a studio (with optional room) or the client's own off-site venue. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Location</Label>
            <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setLocationMode("studio")}
                className={cn(
                  "rounded px-2.5 py-1 transition-colors",
                  !isCustomLocation ? "bg-ink text-paper" : "text-muted hover:text-ink",
                )}
              >
                Studio
              </button>
              <button
                type="button"
                onClick={() => setLocationMode("custom")}
                className={cn(
                  "rounded px-2.5 py-1 transition-colors",
                  isCustomLocation ? "bg-ink text-paper" : "text-muted hover:text-ink",
                )}
              >
                Custom venue
              </button>
            </div>
          </div>

          {isCustomLocation ? (
            <div className="space-y-1.5">
              <Input
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                placeholder="Client office / venue address"
              />
              {request.preferredLocation && (
                <p className="text-xs text-muted">
                  Client suggested:{" "}
                  <span className="text-ink">{request.preferredLocation}</span>
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <LocationRoomFields
                idPrefix="corp-req"
                rooms={rooms}
                locationId={locationId}
                roomId={roomId}
                onLocationChange={setLocationId}
                onRoomChange={setRoomId}
                locationLabel="Studio"
                roomOptional
              />
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Supporting instructors</Label>
          <div className="flex flex-wrap items-center gap-2">
            {supportingInstructorIds.map((sid) => {
              const name =
                instructors.find((i) => i.id === sid)?.name ?? "Unknown";
              return (
                <span
                  key={sid}
                  className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs text-ink"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() =>
                      setSupportingInstructorIds((prev) =>
                        prev.filter((x) => x !== sid),
                      )
                    }
                    className="text-muted hover:text-ink"
                    aria-label={`Remove ${name}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            {availableForSupporting.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v)
                    setSupportingInstructorIds((prev) => [...prev, v]);
                }}
                className="flex h-9 rounded-lg border border-border bg-card px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">
                  {supportingInstructorIds.length === 0
                    ? "+ Add supporting instructor"
                    : "+ Add another"}
                </option>
                {availableForSupporting.map((i) => (
                  <InstructorOption key={i.id} instructor={i} onLeave={onLeave} />
                ))}
              </select>
            )}
            {supportingInstructorIds.length === 0 &&
              availableForSupporting.length === 0 && (
                <span className="text-xs text-muted">
                  No additional instructors available.
                </span>
              )}
          </div>
        </div>

        {submitError && (
          <div className="rounded-md border border-error/30 bg-error/5 p-3 text-xs text-error">
            {submitError}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              submitting ||
              !mainInstructorId ||
              !locationReady ||
              !date ||
              !startTime ||
              !endTime
            }
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Schedule session
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
