"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { Button, Input, Label, PageHeader } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { todayIso } from "@/lib/formatters";
import { ApiError } from "@/lib/api";

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

interface ApiCorporatePackage {
  id: string;
  name: string;
  description: string | null;
  price_sgd: string;
  status: "active" | "archived";
}

export default function NewCorporateSessionPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading…</div>}>
      <NewCorporateSessionForm />
    </Suspense>
  );
}

function NewCorporateSessionForm() {
  const router = useRouter();
  const search = useSearchParams();
  const packageId = search.get("packageId") ?? "";
  const { api, accessibleLocations, activeLocationId } = useWorkspace();

  const [pkg, setPkg] = useState<ApiCorporatePackage | null>(null);
  const [pkgError, setPkgError] = useState<string | null>(null);
  const [instructors, setInstructors] = useState<ApiInstructor[]>([]);
  const [rooms, setRooms] = useState<ApiRoom[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [clientName, setClientName] = useState("");
  const [mainInstructorId, setMainInstructorId] = useState("");
  const [supportingInstructorIds, setSupportingInstructorIds] = useState<string[]>([]);
  const [locationId, setLocationId] = useState(activeLocationId ?? "");
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!api || !packageId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{ corporatePackage: ApiCorporatePackage }>(
          `/portal/admin/corporate-packages/${packageId}`,
        );
        if (cancelled) return;
        setPkg(res.corporatePackage);
      } catch (err) {
        if (cancelled) return;
        setPkgError(
          err instanceof ApiError
            ? err.status === 404
              ? "Corporate package not found."
              : `HTTP ${err.status}`
            : "Network error",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, packageId]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const [ins, rm] = await Promise.all([
          api.get<{ instructors: ApiInstructor[] }>("/portal/admin/instructors"),
          api.get<{ rooms: ApiRoom[] }>("/portal/admin/rooms"),
        ]);
        if (cancelled) return;
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

  useEffect(() => {
    if (activeLocationId && !locationId) setLocationId(activeLocationId);
  }, [activeLocationId, locationId]);

  const activeLocations = useMemo(
    () => accessibleLocations.filter((l) => !l.archivedAt),
    [accessibleLocations],
  );
  const activeInstructors = useMemo(
    () => instructors.filter((i) => !i.archived_at),
    [instructors],
  );
  const roomsForLocation = useMemo(
    () => rooms.filter((r) => !r.archived_at && r.location_id === locationId),
    [rooms, locationId],
  );
  const availableForSupporting = useMemo(
    () =>
      activeInstructors.filter(
        (i) => i.id !== mainInstructorId && !supportingInstructorIds.includes(i.id),
      ),
    [activeInstructors, mainInstructorId, supportingInstructorIds],
  );

  useEffect(() => {
    if (!mainInstructorId) return;
    setSupportingInstructorIds((prev) => prev.filter((id) => id !== mainInstructorId));
  }, [mainInstructorId]);

  useEffect(() => {
    if (roomId && !roomsForLocation.some((r) => r.id === roomId)) setRoomId("");
  }, [roomId, roomsForLocation]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!api || !packageId) return;
    if (!clientName.trim() || !mainInstructorId || !locationId || !roomId) return;
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
      await api.post("/portal/admin/corporate-sessions", {
        corporate_package_id: packageId,
        client_name: clientName.trim(),
        main_instructor_id: mainInstructorId,
        supporting_instructor_ids: supportingInstructorIds,
        location_id: locationId,
        room_id: roomId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      });
      router.push("/admin/schedule");
    } catch (err) {
      setSubmitError(corporateErrorMessage(err));
      setSubmitting(false);
    }
  }

  if (!packageId) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link
          href="/admin/schedule"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Schedule
        </Link>
        <PageHeader
          title="New corporate session"
          description="Pick a corporate package from the Corporate dropdown on the Schedule page."
        />
        <div className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          Missing package id. Open this page via the Corporate dropdown.
        </div>
      </div>
    );
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
        title="New corporate session"
        description="One-off corporate-client session. Doesn't consume credits or bookings."
      />

      {(catalogError || pkgError) && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          {pkgError ?? `Failed to load catalog: ${catalogError}`}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-3 text-sm font-semibold text-ink">Package</h2>
          {pkg ? (
            <div className="rounded-lg border border-border bg-paper/50 px-4 py-3">
              <div className="text-sm font-semibold text-ink">{pkg.name}</div>
              {pkg.description && (
                <p className="mt-1 text-xs text-muted">{pkg.description}</p>
              )}
              <div className="mt-1 font-mono text-xs text-muted">SGD {pkg.price_sgd}</div>
              {pkg.status === "archived" && (
                <p className="mt-2 text-xs text-error">
                  This package is archived and can&apos;t be scheduled.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-paper/50 px-4 py-3 text-xs text-muted">
              {pkgError ?? "Loading package…"}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">Session details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="client">Client name</Label>
              <Input
                id="client"
                required
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. Acme Pte Ltd"
              />
              <p className="text-xs text-muted">
                Free-form. Shown on the schedule tile and in lifecycle audits.
              </p>
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
              <Label htmlFor="loc">Location</Label>
              <SelectField
                id="loc"
                value={locationId}
                onChange={setLocationId}
                placeholder="Select…"
                options={activeLocations.map((l) => ({ val: l.id, label: l.name }))}
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
          <Button type="submit" disabled={submitting || pkg?.status === "archived"}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Create session
          </Button>
        </div>
      </form>
    </div>
  );
}

export function corporateErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Network error";
  const body = (err.body as { error?: string } | null) ?? null;
  switch (body?.error) {
    case "room_conflict":
      return "That room is already booked at that time.";
    case "instructor_conflict":
      return "The main instructor has another session at that time.";
    case "package_archived":
      return "This corporate package is archived and can't be scheduled.";
    case "main_in_supporting":
      return "An instructor can't be both main and supporting.";
    case "bad_time_range":
      return "End time must be after start time.";
    case "package_not_found":
      return "Corporate package not found.";
    case "not_found":
      return "Corporate session not found.";
    default:
      return `Failed (HTTP ${err.status})`;
  }
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
