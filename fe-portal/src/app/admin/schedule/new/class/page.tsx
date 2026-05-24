"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { Button, Input, Label, PageHeader } from "@/components/ui";
import { CapacityFields } from "@/components/schedule/capacity-fields";
import { useWorkspace } from "@/lib/workspace-context";
import { todayIso } from "@/lib/formatters";
import { ApiError } from "@/lib/api";
import type { Capacity, ClassTypeDifficulty } from "@/types";

const DIFFICULTIES: ClassTypeDifficulty[] = ["general", "beginner", "intermediate", "advanced"];

interface ApiClassType {
  id: string;
  name: string;
  archived_at: string | null;
}

interface ApiInstructor {
  id: string;
  name: string;
  status: "pending" | "active" | "archived";
  archived_at: string | null;
}

interface ApiRoom {
  id: string;
  location_id: string;
  name: string;
  archived_at: string | null;
}

export default function NewClassPage() {
  const router = useRouter();
  const { api, activeLocationId } = useWorkspace();

  const [classTypes, setClassTypes] = useState<ApiClassType[]>([]);
  const [instructors, setInstructors] = useState<ApiInstructor[]>([]);
  const [rooms, setRooms] = useState<ApiRoom[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [classTypeId, setClassTypeId] = useState("");
  const [mainInstructorId, setMainInstructorId] = useState("");
  const [supportingInstructorIds, setSupportingInstructorIds] = useState<string[]>([]);
  const [locationId, setLocationId] = useState(activeLocationId ?? "");
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [capacity, setCapacity] = useState<Capacity>({
    waitlist: 0,
    onlineBooking: 18,
    buffer: 2,
  });
  const [creditCost, setCreditCost] = useState("1");
  const [difficulty, setDifficulty] = useState<ClassTypeDifficulty>("general");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const [ct, ins, rm] = await Promise.all([
          api.get<{ class_types: ApiClassType[] }>("/portal/admin/class-types"),
          api.get<{ instructors: ApiInstructor[] }>("/portal/admin/instructors"),
          api.get<{ rooms: ApiRoom[] }>("/portal/admin/rooms"),
        ]);
        if (cancelled) return;
        setClassTypes(ct.class_types);
        setInstructors(ins.instructors);
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

  // Location is driven by the workspace switcher in the top nav — keep this
  // state in sync so room filtering and the create payload stay correct.
  useEffect(() => {
    setLocationId(activeLocationId ?? "");
  }, [activeLocationId]);

  const activeClassTypes = useMemo(
    () => classTypes.filter((c) => !c.archived_at),
    [classTypes],
  );
  const roomsForLocation = useMemo(
    () => rooms.filter((r) => !r.archived_at && r.location_id === locationId),
    [rooms, locationId],
  );
  const activeInstructors = useMemo(
    () => instructors.filter((i) => !i.archived_at),
    [instructors],
  );
  const availableForSupporting = useMemo(
    () =>
      activeInstructors.filter(
        (i) => i.id !== mainInstructorId && !supportingInstructorIds.includes(i.id),
      ),
    [activeInstructors, mainInstructorId, supportingInstructorIds],
  );

  // If the main instructor changes and overlaps a supporting one, drop the dup.
  useEffect(() => {
    if (!mainInstructorId) return;
    setSupportingInstructorIds((prev) => prev.filter((id) => id !== mainInstructorId));
  }, [mainInstructorId]);

  // Clear the selected room if it no longer belongs to the chosen location.
  useEffect(() => {
    if (roomId && !roomsForLocation.some((r) => r.id === roomId)) setRoomId("");
  }, [roomId, roomsForLocation]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!api) return;
    if (!classTypeId || !mainInstructorId || !locationId || !roomId) return;
    if (!date || !startTime || !endTime) return;
    void difficulty;

    const startsAt = new Date(`${date}T${startTime}:00`);
    const endsAt = new Date(`${date}T${endTime}:00`);
    if (endsAt <= startsAt) {
      setSubmitError("End time must be after start time.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.post("/portal/admin/schedule/classes", {
        class_type_id: classTypeId,
        main_instructor_id: mainInstructorId,
        supporting_instructor_ids: supportingInstructorIds,
        location_id: locationId,
        room_id: roomId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        capacity_online: capacity.onlineBooking,
        capacity_waitlist: capacity.waitlist,
        capacity_buffer: capacity.buffer,
        credit_cost: Number(creditCost),
      });
      router.push("/admin/schedule");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { error?: string } | null;
        setSubmitError(
          body?.error === "room_clash"
            ? "That room is already booked for an overlapping time. Pick another room or time."
            : `Failed to create class (HTTP ${err.status})`,
        );
      } else if (err instanceof ApiError && err.status === 400) {
        const body = err.body as { error?: string } | null;
        setSubmitError(
          body?.error === "room_location_mismatch"
            ? "That room belongs to a different location."
            : `Failed to create class (HTTP ${err.status})`,
        );
      } else {
        setSubmitError(
          err instanceof ApiError
            ? `Failed to create class (HTTP ${err.status})`
            : "Network error",
        );
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/admin/schedule"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Schedule
      </Link>
      <PageHeader
        title="New class"
        description="Single class instance. The class will appear on the timetable and occupy the instructor's availability slot."
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
                options={activeClassTypes.map((c) => ({ val: c.id, label: c.name }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ins">Main instructor</Label>
              <SelectField
                id="ins"
                value={mainInstructorId}
                onChange={setMainInstructorId}
                placeholder="Select…"
                options={activeInstructors.map((i) => ({ val: i.id, label: i.name }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Supporting instructors</Label>
              <div className="flex flex-wrap items-center gap-2">
                {supportingInstructorIds.map((sid) => {
                  const name =
                    activeInstructors.find((i) => i.id === sid)?.name ?? "Unknown";
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
                      if (v) setSupportingInstructorIds((prev) => [...prev, v]);
                    }}
                    className="flex h-9 rounded-lg border border-border bg-card px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <option value="">
                      {supportingInstructorIds.length === 0
                        ? "+ Add supporting instructor"
                        : "+ Add another"}
                    </option>
                    {availableForSupporting.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
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
            <div className="space-y-1.5">
              <Label htmlFor="room">Room</Label>
              <SelectField
                id="room"
                value={roomId}
                onChange={setRoomId}
                disabled={!locationId}
                placeholder={locationId ? "Select…" : "No workspace selected"}
                options={roomsForLocation.map((r) => ({ val: r.id, label: r.name }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Difficulty</Label>
              <div className="flex flex-wrap gap-2">
                {DIFFICULTIES.map((d) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      difficulty === d
                        ? "border-accent bg-accent/10 text-ink"
                        : "border-border bg-card text-muted hover:border-accent/40"
                    }`}
                  >
                    {d[0].toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted">
                Set per-instance — the same class type can run at different levels.
              </p>
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
          <h2 className="mb-4 text-sm font-semibold text-ink">Capacity & price</h2>
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
              <p className="text-xs text-muted">Credits charged per booking on this instance.</p>
            </div>
          </div>
        </section>

        {submitError && (
          <div className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
            {submitError}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Link href="/admin/schedule">
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
