"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
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
import { createClassesLabel, repeatWeeklyFromParams } from "@/lib/repeat-weekly";
import { weekdayOf, type SeriesInput } from "@/lib/series";
import {
  SupportingInstructorsField,
  type SupportingRow,
} from "@/components/schedule/supporting-instructors-field";
import {
  InstructorOption,
  useInstructorsOnLeave,
} from "@/components/schedule/instructor-leave";
import { useWorkspace } from "@/lib/workspace-context";
import { useWaitlistsOn } from "@/lib/use-waitlists-on";
import { todayIso, currentHourTime } from "@/lib/formatters";
import { ApiError } from "@/lib/api";
import { scheduleErrorMessage, slotFromParams } from "@/lib/schedule";
import { PAY_OPTIONAL_HINT, payOrNull } from "@/lib/pay";
import {
  fetchActiveClassTypes,
  fetchActiveInstructors,
  fetchActiveRooms,
  type CatalogClassType,
  type CatalogInstructor,
  type CatalogRoom,
} from "@/lib/catalog";
import type { Capacity, ClassTypeDifficulty } from "@/types";

const DIFFICULTIES: ClassTypeDifficulty[] = ["general", "beginner", "intermediate", "advanced"];
export default function NewClassPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <NewClassForm />
    </Suspense>
  );
}

function NewClassForm() {
  const router = useRouter();
  const { api, activeLocationId } = useWorkspace();
  const waitlistsOn = useWaitlistsOn("admin");
  // Picking a slot on the timetable links here with that slot, so the form
  // opens on the day and time the admin already chose. The retired series
  // screen's URL lands here with Repeat weekly on.
  const params = useSearchParams();
  const slot = slotFromParams(params);
  const [repeat, setRepeat] = useState(() => repeatWeeklyFromParams(params));

  const [classTypes, setClassTypes] = useState<CatalogClassType[]>([]);
  const [instructors, setInstructors] = useState<CatalogInstructor[]>([]);
  const [rooms, setRooms] = useState<CatalogRoom[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [classTypeId, setClassTypeId] = useState("");
  const [mainInstructorId, setMainInstructorId] = useState("");
  const [mainPay, setMainPay] = useState("");
  const [supporting, setSupporting] = useState<SupportingRow[]>([]);
  const [locationId, setLocationId] = useState(activeLocationId ?? "");
  const [roomId, setRoomId] = useState("");
  // With Repeat weekly on, `date` is the series' first date.
  const [date, setDate] = useState(slot?.date ?? "");
  const [lastDate, setLastDate] = useState("");
  const [startTime, setStartTime] = useState(slot?.start ?? currentHourTime());
  const [endTime, setEndTime] = useState(slot?.end ?? currentHourTime(1));
  const [capacity, setCapacity] = useState<Capacity>({
    waitlist: 0,
    onlineBooking: 18,
    buffer: 2,
  });
  const [creditCost, setCreditCost] = useState("1");
  const [cancelWindow, setCancelWindow] = useState("");
  const [packageRule, setPackageRule] = useState<PackageRuleDraft>(ACCEPTS_ALL_DRAFT);
  const [difficulty, setDifficulty] = useState<ClassTypeDifficulty>("general");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const onLeave = useInstructorsOnLeave(date);

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

  const roomsForLocation = useMemo(
    () => rooms.filter((r) => r.location_id === locationId),
    [rooms, locationId],
  );
  // Clear the selected room if it no longer belongs to the chosen location.
  useEffect(() => {
    if (roomId && !roomsForLocation.some((r) => r.id === roomId)) setRoomId("");
  }, [roomId, roomsForLocation]);

  /** The series as the API takes it, or a sentence saying what is missing. */
  function buildSeries(): SeriesInput | string {
    if (!classTypeId || !mainInstructorId || !locationId || !roomId) {
      return "Pick a class type, main instructor and room.";
    }
    if (!date || !lastDate) return "Pick a first and a last date.";
    if (endTime <= startTime) return "End time must be after start time.";
    const ownWindow = parseCancelWindow(cancelWindow);
    if (!ownWindow.ok) return ownWindow.message;
    const ruleProblem = packageRuleProblem(packageRule);
    if (ruleProblem) return ruleProblem;
    return {
      class_type_id: classTypeId,
      main_instructor_id: mainInstructorId,
      instructor_pay_sgd: payOrNull(mainPay),
      supporting_instructors: supporting.map((s) => ({
        instructor_id: s.instructorId,
        pay_sgd: payOrNull(s.pay),
      })),
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

  const series = useSeriesDates(api, "admin", repeat ? buildSeries() : "Repeat weekly is off.");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!api) return;
    if (repeat) {
      if (await series.create()) router.push("/admin/schedule");
      return;
    }
    if (!classTypeId || !mainInstructorId || !locationId || !roomId) return;
    if (!date || !startTime || !endTime) return;
    void difficulty;

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
      await api.post("/portal/admin/schedule/classes", {
        class_type_id: classTypeId,
        main_instructor_id: mainInstructorId,
        supporting_instructors: supporting.map((s) => ({
          instructor_id: s.instructorId,
          pay_sgd: payOrNull(s.pay),
        })),
        location_id: locationId,
        room_id: roomId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        capacity_online: capacity.onlineBooking,
        capacity_waitlist: capacity.waitlist,
        capacity_buffer: capacity.buffer,
        credit_cost: Number(creditCost),
        instructor_pay_sgd: payOrNull(mainPay),
        cancel_window_hours: ownWindow.hours,
        package_rule: packageRuleBody(packageRule),
      });
      router.push("/admin/schedule");
    } catch (err) {
      setSubmitError(scheduleErrorMessage(err, "Failed to create class"));
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
        description={
          repeat
            ? "A weekly class set up once. Every week in the range becomes an ordinary class you can still edit, cancel or restaff on its own."
            : "Single class instance. The class will appear on the timetable and occupy the instructor's availability slot."
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
            {/* Holds the right column empty on a wide screen; on a phone it
                would only add a blank gap. */}
            <div className="hidden sm:block" />
            <div className="space-y-1.5">
              <Label htmlFor="ins">Main instructor</Label>
              <SelectField
                id="ins"
                value={mainInstructorId}
                onChange={setMainInstructorId}
                placeholder="Select…"
              >
                {instructors.map((i) => (
                  <InstructorOption
                    key={i.id}
                    instructor={i}
                    onLeave={onLeave}
                    startTime={startTime}
                  />
                ))}
              </SelectField>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="main-pay">
                Main instructor pay{repeat ? " per class" : ""} (S$) · optional
              </Label>
              <Input
                id="main-pay"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={mainPay}
                onChange={(e) => setMainPay(e.target.value)}
                aria-describedby="main-pay-hint"
              />
              <p id="main-pay-hint" className="text-xs text-muted">
                {PAY_OPTIONAL_HINT}
              </p>
            </div>
            <SupportingInstructorsField
              instructors={instructors}
              mainInstructorId={mainInstructorId}
              value={supporting}
              onChange={setSupporting}
              onLeave={onLeave}
              startTime={startTime}
            />
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
                    className={`min-h-9 rounded-full border px-3.5 py-1 text-xs transition sm:min-h-8 ${
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

        <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">When</h2>
            <RepeatWeeklySwitch checked={repeat} onChange={setRepeat} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
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
          <h2 className="mb-4 text-sm font-semibold text-ink">Capacity & price</h2>
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
              <p className="text-xs text-muted">Credits charged per booking on this instance.</p>
            </div>
            <CancelWindowField
              value={cancelWindow}
              onChange={setCancelWindow}
              {...(repeat ? { hint: SERIES_WINDOW_HINT } : {})}
            />
            <PackageRuleField
              role="admin"
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
          <Link href="/admin/schedule">
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
  children,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  options?: { val: string; label: string }[];
  /** Pre-rendered `<option>`s, for callers that need more than a flat label. */
  children?: React.ReactNode;
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
      {children ??
        options?.map((o) => (
          <option key={o.val} value={o.val}>
            {o.label}
          </option>
        ))}
    </select>
  );
}
