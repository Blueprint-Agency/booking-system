"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { Button, Input, Label, PageHeader } from "@/components/ui";
import { CapacityFields } from "@/components/schedule/capacity-fields";
import { useWorkspace } from "@/lib/workspace-context";
import { todayIso, currentHourTime } from "@/lib/formatters";
import { ApiError } from "@/lib/api";
import { scheduleErrorMessage } from "@/lib/schedule";
import type { Capacity } from "@/types";

interface ApiClassType {
  id: string;
  name: string;
}
interface ApiRoom {
  id: string;
  location_id: string;
  name: string;
}

export default function InstructorNewClassPage() {
  const router = useRouter();
  const { api, activeLocationId, accessibleLocations } = useWorkspace();

  const [classTypes, setClassTypes] = useState<ApiClassType[]>([]);
  const [rooms, setRooms] = useState<ApiRoom[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [classTypeId, setClassTypeId] = useState("");
  const [locationId, setLocationId] = useState(activeLocationId ?? "");
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState(currentHourTime());
  const [endTime, setEndTime] = useState(currentHourTime(1));
  const [capacity, setCapacity] = useState<Capacity>({
    waitlist: 0,
    onlineBooking: 18,
    buffer: 2,
  });
  const [creditCost, setCreditCost] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const [ct, rm] = await Promise.all([
          api.get<{ class_types: ApiClassType[] }>(
            "/portal/instructor/catalog/class-types",
          ),
          api.get<{ rooms: ApiRoom[] }>("/portal/instructor/catalog/rooms"),
        ]);
        if (cancelled) return;
        setClassTypes(ct.class_types);
        setRooms(rm.rooms);
      } catch (err) {
        if (cancelled) return;
        setCatalogError(
          err instanceof ApiError ? `HTTP ${err.status}` : "Network error",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Default the location to the active workspace; instructors can switch it here.
  useEffect(() => {
    setLocationId((prev) => prev || activeLocationId || "");
  }, [activeLocationId]);

  const roomsForLocation = useMemo(
    () => rooms.filter((r) => r.location_id === locationId),
    [rooms, locationId],
  );

  // Clear the selected room if it no longer belongs to the chosen location.
  useEffect(() => {
    if (roomId && !roomsForLocation.some((r) => r.id === roomId)) setRoomId("");
  }, [roomId, roomsForLocation]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!api) return;
    if (!classTypeId || !locationId || !roomId) return;
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
      await api.post("/portal/instructor/schedule/classes", {
        class_type_id: classTypeId,
        location_id: locationId,
        room_id: roomId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        capacity_online: capacity.onlineBooking,
        capacity_waitlist: capacity.waitlist,
        capacity_buffer: capacity.buffer,
        credit_cost: Number(creditCost),
      });
      router.push("/instructor/schedule");
    } catch (err) {
      setSubmitError(scheduleErrorMessage(err, "Failed to create class"));
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/instructor/schedule"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to my schedule
      </Link>
      <PageHeader
        title="New class"
        description="The class is scheduled under your name. Pay is left for an admin to set later."
      />

      {catalogError && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          Failed to load catalog: {catalogError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">Class details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ct">Class type</Label>
              <SelectField
                id="ct"
                value={classTypeId}
                onChange={setClassTypeId}
                placeholder="Select…"
                options={classTypes.map((c) => ({ val: c.id, label: c.name }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc">Location</Label>
              <SelectField
                id="loc"
                value={locationId}
                onChange={setLocationId}
                placeholder="Select…"
                options={accessibleLocations.map((l) => ({ val: l.id, label: l.name }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="room">Room</Label>
              <SelectField
                id="room"
                value={roomId}
                onChange={setRoomId}
                disabled={!locationId}
                placeholder={locationId ? "Select…" : "Pick a location first"}
                options={roomsForLocation.map((r) => ({ val: r.id, label: r.name }))}
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">When</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="d">Date</Label>
              <Input
                id="d"
                required
                type="date"
                min={todayIso()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t">Start time</Label>
              <Input
                id="t"
                required
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end">End time</Label>
              <Input
                id="end"
                required
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">Capacity & credits</h2>
          <div className="space-y-4">
            <CapacityFields value={capacity} onChange={setCapacity} />
            <div className="space-y-1.5">
              <Label htmlFor="credit">Credit cost</Label>
              <Input
                id="credit"
                required
                type="number"
                min={0}
                step={1}
                value={creditCost}
                onChange={(e) => setCreditCost(e.target.value)}
              />
              <p className="text-xs text-muted">
                Credits charged per booking on this class.
              </p>
            </div>
          </div>
        </section>

        {submitError && (
          <div className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
            {submitError}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Link href="/instructor/schedule">
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Create class
          </Button>
        </div>
      </form>
    </div>
  );
}

function SelectField({
  id,
  value,
  onChange,
  placeholder,
  options,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  options: { val: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      required
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.val} value={o.val}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
