"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Repeat, Save } from "lucide-react";
import { Button, Input, Label, PageHeader } from "@/components/ui";
import { CapacityFields } from "@/components/schedule/capacity-fields";
import { CancelWindowField } from "@/components/schedule/cancel-window-field";
import { PackageRuleField } from "@/components/schedule/package-rule-field";
import {
  ACCEPTS_ALL_DRAFT,
  SERIES_RULE_HINT,
  packageRuleBody,
  packageRuleProblem,
  type PackageRuleDraft,
} from "@/lib/package-rule";
import {
  RepeatRangeFields,
  RepeatWeeklySwitch,
  SERIES_WINDOW_HINT,
  SeriesDatesSection,
  useSeriesDates,
} from "@/components/schedule/repeat-weekly";
import { parseCancelWindow } from "@/lib/cancel-window";
import { createClassesLabel } from "@/lib/repeat-weekly";
import { weekdayOf, type OwnSeriesInput } from "@/lib/series";
import { LocationRoomFields } from "@/components/schedule/location-room-fields";
import { useWorkspace } from "@/lib/workspace-context";
import { useWaitlistsOn } from "@/lib/use-waitlists-on";
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
  const { api, activeLocationId } = useWorkspace();
  const waitlistsOn = useWaitlistsOn("instructor");

  const [classTypes, setClassTypes] = useState<ApiClassType[]>([]);
  const [rooms, setRooms] = useState<ApiRoom[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [classTypeId, setClassTypeId] = useState("");
  const [locationId, setLocationId] = useState(activeLocationId ?? "");
  const [roomId, setRoomId] = useState("");
  const [repeat, setRepeat] = useState(false);
  // With Repeat weekly on, `date` is the series' first date.
  const [date, setDate] = useState("");
  const [lastDate, setLastDate] = useState("");
  const [startTime, setStartTime] = useState(currentHourTime());
  const [endTime, setEndTime] = useState(currentHourTime(1));
  const [capacity, setCapacity] = useState<Capacity>({
    waitlist: 0,
    onlineBooking: 18,
    buffer: 2,
  });
  const [creditCost, setCreditCost] = useState("1");
  const [cancelWindow, setCancelWindow] = useState("");
  const [packageRule, setPackageRule] = useState<PackageRuleDraft>(ACCEPTS_ALL_DRAFT);
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

  /**
   * The series as the API takes it, or a sentence saying what is missing. No
   * instructors or pay: the caller teaches every class, and an admin prices them.
   */
  function buildSeries(): OwnSeriesInput | string {
    if (!classTypeId || !locationId || !roomId) return "Pick a class type, location and room.";
    if (!date || !lastDate) return "Pick a first and a last date.";
    if (endTime <= startTime) return "End time must be after start time.";
    const ownWindow = parseCancelWindow(cancelWindow);
    if (!ownWindow.ok) return ownWindow.message;
    const ruleProblem = packageRuleProblem(packageRule);
    if (ruleProblem) return ruleProblem;
    return {
      class_type_id: classTypeId,
      location_id: locationId,
      room_id: roomId,
      weekday: weekdayOf(date),
      start_time: startTime,
      end_time: endTime,
      capacity_online: capacity.onlineBooking,
      capacity_waitlist: capacity.waitlist,
      capacity_buffer: capacity.buffer,
      credit_cost: Number(creditCost),
      cancel_window_hours: ownWindow.hours,
      package_rule: packageRuleBody(packageRule),
      first_date: date,
      last_date: lastDate,
      excluded_dates: [],
    };
  }

  const series = useSeriesDates(api, "instructor", repeat ? buildSeries() : "Repeat weekly is off.");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!api) return;
    if (repeat) {
      if (await series.create()) router.push("/instructor/schedule");
      return;
    }
    if (!classTypeId || !locationId || !roomId) return;
    if (!date || !startTime || !endTime) return;

    const startsAt = new Date(`${date}T${startTime}:00`);
    const endsAt = new Date(`${date}T${endTime}:00`);
    if (endsAt <= startsAt) {
      setSubmitError("End time must be after start time.");
      return;
    }
    const ownWindow = parseCancelWindow(cancelWindow);
    if (!ownWindow.ok) {
      setSubmitError(ownWindow.message);
      return;
    }
    const ruleProblem = packageRuleProblem(packageRule);
    if (ruleProblem) {
      setSubmitError(ruleProblem);
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
        cancel_window_hours: ownWindow.hours,
        package_rule: packageRuleBody(packageRule),
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
        className="mb-2 inline-flex min-h-10 items-center gap-1 text-sm text-muted hover:text-ink sm:min-h-0"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to my schedule
      </Link>
      <PageHeader
        title="New class"
        description={
          repeat
            ? "One class every week in the range, each scheduled under your name. Pay is left for an admin to set later."
            : "The class is scheduled under your name. Pay is left for an admin to set later."
        }
      />

      {catalogError && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          Failed to load catalog: {catalogError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
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
            <LocationRoomFields
              idPrefix="ins-cls"
              rooms={rooms}
              locationId={locationId}
              roomId={roomId}
              onLocationChange={setLocationId}
              onRoomChange={setRoomId}
            />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">When</h2>
            <RepeatWeeklySwitch checked={repeat} onChange={setRepeat} />
          </div>
          {/* The date takes its own row on a phone; the two times pair up under it. */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label htmlFor="d">{repeat ? "First date" : "Date"}</Label>
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
            {repeat && (
              <RepeatRangeFields firstDate={date} lastDate={lastDate} onLastDateChange={setLastDate} />
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">Capacity & credits</h2>
          <div className="space-y-4">
            <CapacityFields value={capacity} onChange={setCapacity} waitlistsOn={waitlistsOn} />
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
            <CancelWindowField
              value={cancelWindow}
              onChange={setCancelWindow}
              {...(repeat ? { hint: SERIES_WINDOW_HINT } : {})}
            />
            <PackageRuleField
              role="instructor"
              value={packageRule}
              onChange={setPackageRule}
              {...(repeat ? { hint: SERIES_RULE_HINT } : {})}
            />
          </div>
        </section>

        {repeat && <SeriesDatesSection dates={series} />}

        {(repeat ? series.error : submitError) && (
          <div className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
            {repeat ? series.error : submitError}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Link href="/instructor/schedule">
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          {/* With Repeat weekly on, nothing is created until the dates are previewed. */}
          <Button type="submit" disabled={repeat ? !series.canCreate : submitting}>
            {(repeat ? series.busy === "create" : submitting) ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : repeat ? (
              <Repeat className="h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {createClassesLabel(repeat, series.creating)}
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
