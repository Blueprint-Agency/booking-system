"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarSearch, Loader2, Repeat } from "lucide-react";
import { Button, Input, Label, PageHeader } from "@/components/ui";
import { CapacityFields } from "@/components/schedule/capacity-fields";
import {
  SupportingInstructorsField,
  type SupportingRow,
} from "@/components/schedule/supporting-instructors-field";
import { InstructorOption, useInstructorsOnLeave } from "@/components/schedule/instructor-leave";
import { SeriesPreviewList, blockingDates } from "@/components/schedule/series-preview";
import { useWorkspace } from "@/lib/workspace-context";
import { useWaitlistsOn } from "@/lib/use-waitlists-on";
import { todayIso, currentHourTime } from "@/lib/formatters";
import { ApiError } from "@/lib/api";
import { slotFromParams } from "@/lib/schedule";
import {
  WEEKDAYS,
  createSeries,
  previewSeries,
  seriesErrorMessage,
  weekdayOf,
  type IsoWeekday,
  type Preview,
  type SeriesInput,
} from "@/lib/series";
import {
  fetchActiveClassTypes,
  fetchActiveInstructors,
  fetchActiveRooms,
  type CatalogClassType,
  type CatalogInstructor,
  type CatalogRoom,
} from "@/lib/catalog";
import type { Capacity } from "@/types";

export default function NewSeriesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <NewSeriesForm />
    </Suspense>
  );
}

function NewSeriesForm() {
  const router = useRouter();
  const { api, activeLocationId } = useWorkspace();
  const waitlistsOn = useWaitlistsOn("admin");
  // A slot picked on the timetable seeds the weekday, the times and the first date.
  const slot = slotFromParams(useSearchParams());

  const [classTypes, setClassTypes] = useState<CatalogClassType[]>([]);
  const [instructors, setInstructors] = useState<CatalogInstructor[]>([]);
  const [rooms, setRooms] = useState<CatalogRoom[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [classTypeId, setClassTypeId] = useState("");
  const [mainInstructorId, setMainInstructorId] = useState("");
  const [mainPay, setMainPay] = useState("");
  const [supporting, setSupporting] = useState<SupportingRow[]>([]);
  // Location is the workspace switcher's, in the top nav.
  const locationId = activeLocationId ?? "";
  const [pickedRoomId, setRoomId] = useState("");
  const [weekday, setWeekday] = useState<IsoWeekday>(slot ? weekdayOf(slot.date) : 1);
  const [startTime, setStartTime] = useState(slot?.start ?? currentHourTime());
  const [endTime, setEndTime] = useState(slot?.end ?? currentHourTime(1));
  const [firstDate, setFirstDate] = useState(slot?.date ?? todayIso());
  const [lastDate, setLastDate] = useState("");
  const [capacity, setCapacity] = useState<Capacity>({ waitlist: 0, onlineBooking: 18, buffer: 2 });
  const [creditCost, setCreditCost] = useState("1");

  const [preview, setPreview] = useState<{ key: string; result: Preview } | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"preview" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onLeave = useInstructorsOnLeave(firstDate);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const [ct, ins, rm] = await Promise.all([
          fetchActiveClassTypes(api),
          fetchActiveInstructors(api),
          fetchActiveRooms(api),
        ]);
        if (cancelled) return;
        setClassTypes(ct);
        setInstructors(ins);
        setRooms(rm);
      } catch (err) {
        if (cancelled) return;
        setCatalogError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const roomsForLocation = useMemo(
    () => rooms.filter((r) => r.location_id === locationId),
    [rooms, locationId],
  );
  // A room picked before the workspace switched no longer counts.
  const roomId = roomsForLocation.some((r) => r.id === pickedRoomId) ? pickedRoomId : "";

  /** The template as the API takes it, or a sentence saying what is missing. */
  function buildInput(): SeriesInput | string {
    if (!classTypeId || !mainInstructorId || !locationId || !roomId) {
      return "Pick a class type, main instructor and room.";
    }
    if (!firstDate || !lastDate) return "Pick a first and a last date.";
    if (endTime <= startTime) return "End time must be after start time.";
    if (mainPay.trim() === "") return "Enter the main instructor's pay.";
    if (supporting.some((s) => s.pay.trim() === "")) {
      return "Enter the pay for every supporting instructor.";
    }
    return {
      class_type_id: classTypeId,
      main_instructor_id: mainInstructorId,
      instructor_pay_sgd: Number(mainPay),
      supporting_instructors: supporting.map((s) => ({
        instructor_id: s.instructorId,
        pay_sgd: Number(s.pay),
      })),
      location_id: locationId,
      room_id: roomId,
      weekday,
      start_time: startTime,
      end_time: endTime,
      capacity_online: capacity.onlineBooking,
      capacity_waitlist: capacity.waitlist,
      capacity_buffer: capacity.buffer,
      credit_cost: Number(creditCost),
      first_date: firstDate,
      last_date: lastDate,
      excluded_dates: [],
    };
  }

  const built = buildInput();
  const inputKey = typeof built === "string" ? null : JSON.stringify(built);
  // Any change to the form after a preview makes that preview stale.
  const current = preview && preview.key === inputKey ? preview.result : null;
  const blocking = current ? blockingDates(current.dates, skipped) : 0;
  const creating = current ? current.dates.filter((d) => !skipped.has(d.date)).length : 0;

  /**
   * `after` re-previews after a refused create: the admin's own skips (a
   * holiday) survive, and the refusal stays on screen to say why the list changed.
   */
  async function runPreview(after?: { keep: ReadonlySet<string>; notice: string }) {
    if (!api) return;
    if (typeof built === "string") return setError(built);
    setBusy("preview");
    setError(after?.notice ?? null);
    try {
      const result = await previewSeries(api, built);
      setPreview({ key: JSON.stringify(built), result });
      // Clashing dates start unticked: the admin opts back in once it is fixed.
      const clashing = result.dates.filter((d) => d.clashes.length > 0).map((d) => d.date);
      setSkipped(new Set([...(after?.keep ?? []), ...clashing]));
    } catch (err) {
      setPreview(null);
      setError(seriesErrorMessage(err, "Preview failed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleCreate() {
    if (!api || typeof built === "string" || !current || blocking > 0) return;
    setBusy("create");
    setError(null);
    try {
      await createSeries(api, { ...built, excluded_dates: [...skipped].sort() });
      router.push("/admin/schedule");
    } catch (err) {
      const notice = seriesErrorMessage(err, "Failed to create series");
      setError(notice);
      setBusy(null);
      // Something changed since the preview (a class booked into the room);
      // show the dates as they are now.
      if (err instanceof ApiError && err.status === 409) void runPreview({ keep: skipped, notice });
    }
  }

  const toggle = (date: string) =>
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/admin/schedule"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Schedule
      </Link>
      <PageHeader
        title="New class series"
        description="A weekly class set up once. Every week in the range becomes an ordinary class you can still edit, cancel or restaff on its own."
      />

      {catalogError && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          Failed to load catalog: {catalogError}
        </div>
      )}

      <div className="space-y-6">
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
            <div className="space-y-1.5">
              <Label htmlFor="ins">Main instructor</Label>
              <SelectField
                id="ins"
                value={mainInstructorId}
                onChange={setMainInstructorId}
                placeholder="Select…"
              >
                {instructors.map((i) => (
                  <InstructorOption key={i.id} instructor={i} onLeave={onLeave} startTime={startTime} />
                ))}
              </SelectField>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="main-pay">Main instructor pay per class (S$)</Label>
              <Input
                id="main-pay"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={mainPay}
                onChange={(e) => setMainPay(e.target.value)}
              />
            </div>
            <SupportingInstructorsField
              instructors={instructors}
              mainInstructorId={mainInstructorId}
              value={supporting}
              onChange={setSupporting}
              onLeave={onLeave}
              startTime={startTime}
            />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">Every week</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="wd">Day</Label>
              <SelectField
                id="wd"
                value={String(weekday)}
                onChange={(v) => setWeekday(Number(v) as IsoWeekday)}
                options={WEEKDAYS.map((w) => ({ val: String(w.value), label: w.label }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t">Start time</Label>
              <Input id="t" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end">End time</Label>
              <Input id="end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="first">First date</Label>
              <Input
                id="first"
                type="date"
                min={todayIso()}
                value={firstDate}
                onChange={(e) => setFirstDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last">Last date</Label>
              <Input
                id="last"
                type="date"
                min={firstDate}
                value={lastDate}
                onChange={(e) => setLastDate(e.target.value)}
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">
            Up to one year at a time. Times are the studio&apos;s local time. Extend the series later
            to keep it going.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">Capacity & price</h2>
          <div className="space-y-4">
            <CapacityFields value={capacity} onChange={setCapacity} waitlistsOn={waitlistsOn} />
            <div className="space-y-1.5">
              <Label htmlFor="credit">Credit cost</Label>
              <Input
                id="credit"
                type="number"
                min={0}
                step={1}
                value={creditCost}
                onChange={(e) => setCreditCost(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">Dates</h2>
              <p className="text-xs text-muted">
                Untick a date to skip it, such as a public holiday.
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={() => void runPreview()} disabled={busy !== null}>
              {busy === "preview" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CalendarSearch className="h-4 w-4" />
              )}
              {current ? "Preview again" : "Preview dates"}
            </Button>
          </div>
          {current ? (
            <>
              <SeriesPreviewList dates={current.dates} skipped={skipped} onToggle={toggle} />
              {blocking > 0 && (
                <p className="mt-2 text-xs text-error">
                  {blocking} ticked {blocking === 1 ? "date clashes" : "dates clash"}. Untick{" "}
                  {blocking === 1 ? "it" : "them"}, or fix the clash and preview again.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">
              {preview ? "The form changed. Preview again to see the dates." : "Preview to see every date before anything is created."}
            </p>
          )}
        </section>

        {error && (
          <div className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Link href="/admin/schedule">
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={busy !== null || !current || blocking > 0 || creating === 0}
          >
            {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Repeat className="h-4 w-4" />}
            {current ? `Create ${creating} ${creating === 1 ? "class" : "classes"}` : "Create series"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SelectField({
  id,
  value,
  onChange,
  placeholder,
  options,
  children,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  options?: { val: string; label: string }[];
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {children ??
        options?.map((o) => (
          <option key={o.val} value={o.val}>
            {o.label}
          </option>
        ))}
    </select>
  );
}
