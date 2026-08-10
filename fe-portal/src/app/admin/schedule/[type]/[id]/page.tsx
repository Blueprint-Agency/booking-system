"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Check, Loader2, Save } from "lucide-react";
import { Badge, Button, Input, Label } from "@/components/ui";
import { LocationRoomFields } from "@/components/schedule/location-room-fields";
import {
  SupportingInstructorsField,
  type SupportingRow,
} from "@/components/schedule/supporting-instructors-field";
import {
  InstructorOption,
  useInstructorsOnLeave,
} from "@/components/schedule/instructor-leave";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { computeEventState } from "@/lib/event-state";
import { formatDate, formatTime, formatDateTime, formatSgd } from "@/lib/formatters";
import { localDay } from "@/lib/local-day";
import {
  cancelClass,
  cancelCorporateSession,
  cancelPtRequest,
  fetchClassDetail,
  fetchCorporatePackageBrief,
  fetchCorporateSession,
  fetchPtDetail,
  patchClass,
  patchCorporateSession,
  patchPtSession,
  scheduleErrorMessage,
  type ScheduleClassAttendee,
  type ScheduleClassDetail,
  type ClassDifficulty,
  type ScheduleCorporatePackageBrief,
  type ScheduleCorporateSession,
  type SchedulePtAttendee,
  type SchedulePtDetail,
} from "@/lib/schedule";
import {
  fetchActiveClassTypes,
  fetchActiveInstructors,
  fetchActiveRooms,
  type CatalogClassType,
  type CatalogInstructor,
  type CatalogRoom,
} from "@/lib/catalog";
import type { EventState } from "@/types";

interface ApiWorkshopDay {
  id: string;
  ord: number;
  starts_at: string;
  ends_at: string;
  capacity_online: number;
  capacity_waitlist: number;
  capacity_buffer: number;
}

interface ApiWorkshopTier {
  id: string;
  name: string;
  description: string | null;
  regular_price_sgd: string;
  early_bird_price_sgd: string | null;
  early_bird_quota: number | null;
  early_bird_cutoff_at: string | null;
  ord: number;
  day_ids: string[];
}

interface ApiWorkshopDetail {
  id: string;
  name: string;
  location_id: string;
  description_html: string | null;
  lifecycle: "active" | "cancelled";
  days: ApiWorkshopDay[];
  tiers: ApiWorkshopTier[];
  instructor_ids: string[];
}

const DIFFICULTY_LABEL: Record<ClassDifficulty, string> = {
  general: "All levels",
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export default function SessionDetailPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = use(params);

  if (type === "workshop") return <WorkshopDetail id={id} />;
  if (type === "class") return <ClassDetail id={id} />;
  if (type === "pt") return <PtDetail id={id} />;
  if (type === "corporate") return <CorporateDetail id={id} />;
  return <ErrorDetail kind="Unknown" message="Unknown session type." />;
}

/* ------------------------------- Class ------------------------------- */

function ClassDetail({ id }: { id: string }) {
  const { api } = useWorkspace();
  const [data, setData] = useState<ScheduleClassDetail | null>(null);
  const [instructors, setInstructors] = useState<CatalogInstructor[]>([]);
  const [classTypes, setClassTypes] = useState<CatalogClassType[]>([]);
  const [rooms, setRooms] = useState<CatalogRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const [d, ins, ct, rm] = await Promise.all([
        fetchClassDetail(api, id),
        fetchActiveInstructors(api),
        fetchActiveClassTypes(api),
        fetchActiveRooms(api),
      ]);
      setData(d);
      setInstructors(ins);
      setClassTypes(ct);
      setRooms(rm);
    } catch (err) {
      setError(detailError(err, "Class not found."));
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCancelClass() {
    if (!api || !data) return;
    if (!confirm("Cancel this class? Attendee bookings will be cancelled and credits returned.")) {
      return;
    }
    setCancelBusy(true);
    setActionError(null);
    try {
      await cancelClass(api, data.id);
      await load();
    } catch (err) {
      setActionError(detailError(err, "Class not found."));
    } finally {
      setCancelBusy(false);
    }
  }

  if (loading) return <LoadingDetail label="class" />;
  if (error || !data) return <ErrorDetail kind="Class" message={error ?? "Class not found."} />;

  const state = computeEventState({
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    lifecycle: data.lifecycle,
  });
  const capacity = data.capacity_online + data.capacity_waitlist + data.capacity_buffer;

  return (
    <DetailFrame>
      <DetailHeader
        badge={<Badge tone="cyan">Class</Badge>}
        state={state}
        title={data.class_type?.name ?? "Class"}
        meta={[
          formatDate(data.starts_at),
          `${formatTime(data.starts_at)} – ${formatTime(data.ends_at)}`,
        ]}
        action={
          data.lifecycle === "active" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancelClass}
              disabled={cancelBusy}
              className="text-error hover:text-error"
            >
              {cancelBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Ban className="h-4 w-4" />
              )}
              Cancel class
            </Button>
          ) : undefined
        }
      />

      {actionError && (
        <p className="mb-4 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {actionError}
        </p>
      )}

      <section className="mb-6 rounded-xl border border-border bg-card p-5 shadow-soft">
        <h2 className="mb-4 text-sm font-semibold text-ink">Details</h2>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField label="Date" value={formatDate(data.starts_at)} />
          <DetailField
            label="Time"
            value={`${formatTime(data.starts_at)} – ${formatTime(data.ends_at)}`}
          />
          <DetailField label="Location" value={data.location?.name ?? "—"} />
          <DetailField label="Room" value={data.room?.name ?? "—"} />
          <DetailField label="Difficulty">
            <Badge tone={data.difficulty === "general" ? "neutral" : "accent"}>
              {DIFFICULTY_LABEL[data.difficulty]}
            </Badge>
          </DetailField>
          <DetailField
            label="Scheduled by"
            value={data.scheduled_by?.name ?? "—"}
            sub={`on ${formatDateTime(data.created_at)}`}
          />
        </dl>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Booked" value={`${data.booked_count} / ${capacity}`} />
        <Stat label="Credit cost" value={`${data.credit_cost} credit${data.credit_cost === 1 ? "" : "s"}`} />
        <Stat label="Capacity split" value={`${data.capacity_online} / ${data.capacity_waitlist} / ${data.capacity_buffer}`} sub="online / waitlist / buffer" />
      </div>
      <ClassRoster
        attendees={data.attendees ?? []}
        startsAt={data.starts_at}
        cancelled={data.lifecycle === "cancelled"}
      />
      <ClassEditor
        data={data}
        instructors={instructors}
        classTypes={classTypes}
        rooms={rooms}
        onSaved={load}
      />
    </DetailFrame>
  );
}

const PACKAGE_KIND_LABEL: Record<NonNullable<ScheduleClassAttendee["package_kind"]>, string> = {
  credit_bundle: "Credit bundle",
  unlimited: "Unlimited",
  trial: "Trial pass",
  pt: "PT",
};

function ClassRoster({
  attendees,
  startsAt,
  cancelled,
}: {
  attendees: ScheduleClassAttendee[];
  startsAt: string;
  cancelled: boolean;
}) {
  const { api } = useWorkspace();
  const [rows, setRows] = useState<ScheduleClassAttendee[]>(attendees);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Re-sync when the parent reloads the class.
  useEffect(() => setRows(attendees), [attendees]);

  // The tick is only available from the class start time onwards.
  const started = Date.now() >= new Date(startsAt).getTime();
  const attendedCount = rows.filter((r) => r.check_in_state === "attended").length;

  async function toggle(a: ScheduleClassAttendee) {
    if (!api || cancelled || !started || busyId) return;
    const attended = a.check_in_state !== "attended";
    setBusyId(a.booking_id);
    setErr(null);
    try {
      const res = await api.post<{ check_in_state: ScheduleClassAttendee["check_in_state"] }>(
        "/portal/admin/check-in/manual",
        { booking_id: a.booking_id, attended },
      );
      setRows((prev) =>
        prev.map((r) =>
          r.booking_id === a.booking_id ? { ...r, check_in_state: res.check_in_state } : r,
        ),
      );
    } catch (e) {
      setErr(
        e instanceof ApiError && e.status === 422
          ? "Check-in opens once the class has started."
          : "Couldn't update attendance. Please try again.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-soft">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Booked clients ({rows.length})</h2>
        {rows.length > 0 && (
          <span className="text-xs text-muted">{attendedCount} checked in</span>
        )}
      </div>
      {!started && !cancelled && rows.length > 0 && (
        <p className="mb-3 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted">
          Check-in opens when the class starts.
        </p>
      )}
      {err && (
        <p className="mb-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {err}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No bookings yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((a) => {
            const attended = a.check_in_state === "attended";
            const noShow = a.check_in_state === "no_show";
            const disabled = cancelled || !started || busyId === a.booking_id;
            return (
              <li
                key={a.booking_id}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <Link
                    href={`/admin/clients/${a.client.id}`}
                    className="text-ink hover:text-accent"
                  >
                    {a.client.name}
                  </Link>
                  <div className="text-xs text-muted">
                    {a.package_kind ? PACKAGE_KIND_LABEL[a.package_kind] : "—"} · {a.code}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {noShow && !attended && (
                    <Badge tone="error">No-show</Badge>
                  )}
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={attended}
                    aria-label={attended ? "Mark as not attended" : "Mark as attended"}
                    disabled={disabled}
                    onClick={() => toggle(a)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      attended
                        ? "border-sage/40 bg-sage/15 text-sage"
                        : "border-border bg-card text-muted hover:border-accent/40 hover:text-ink"
                    }`}
                  >
                    {busyId === a.booking_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded border ${
                          attended ? "border-sage bg-sage text-white" : "border-muted"
                        }`}
                      >
                        {attended && <Check className="h-3 w-3" />}
                      </span>
                    )}
                    {attended ? "Attended" : "Mark attended"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ClassEditor({
  data,
  instructors,
  classTypes,
  rooms,
  onSaved,
}: {
  data: ScheduleClassDetail;
  instructors: CatalogInstructor[];
  classTypes: CatalogClassType[];
  rooms: CatalogRoom[];
  onSaved: () => void | Promise<void>;
}) {
  const { api } = useWorkspace();
  const disabled = data.lifecycle === "cancelled";

  const [classTypeId, setClassTypeId] = useState(data.class_type?.id ?? "");
  const [mainInstructorId, setMainInstructorId] = useState(data.main_instructor_id ?? "");
  const [mainPay, setMainPay] = useState(
    data.instructor_pay_sgd == null ? "" : String(data.instructor_pay_sgd),
  );
  const [supporting, setSupporting] = useState<SupportingRow[]>(
    data.supporting_instructors.map((s) => ({
      instructorId: s.id,
      pay: s.pay_sgd == null ? "" : String(s.pay_sgd),
    })),
  );
  const [locationId, setLocationId] = useState(data.location?.id ?? "");
  const [roomId, setRoomId] = useState(data.room?.id ?? "");
  const [date, setDate] = useState(localDay(data.starts_at));
  const [startTime, setStartTime] = useState(toHHMM(data.starts_at));
  const [endTime, setEndTime] = useState(toHHMM(data.ends_at));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onLeave = useInstructorsOnLeave(date);

  // Re-sync when the parent reloads the class.
  useEffect(() => {
    setClassTypeId(data.class_type?.id ?? "");
    setMainInstructorId(data.main_instructor_id ?? "");
    setMainPay(data.instructor_pay_sgd == null ? "" : String(data.instructor_pay_sgd));
    setSupporting(
      data.supporting_instructors.map((s) => ({
        instructorId: s.id,
        pay: s.pay_sgd == null ? "" : String(s.pay_sgd),
      })),
    );
    setLocationId(data.location?.id ?? "");
    setRoomId(data.room?.id ?? "");
    setDate(localDay(data.starts_at));
    setStartTime(toHHMM(data.starts_at));
    setEndTime(toHHMM(data.ends_at));
  }, [data]);

  async function handleSave() {
    if (!api) return;
    if (!classTypeId || !mainInstructorId || !locationId || !roomId) return;
    if (!date || !startTime || !endTime) return;
    const startsAt = new Date(`${date}T${startTime}:00`);
    const endsAt = new Date(`${date}T${endTime}:00`);
    if (endsAt <= startsAt) {
      setErr("End time must be after start time.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await patchClass(api, data.id, {
        class_type_id: classTypeId,
        main_instructor_id: mainInstructorId,
        instructor_pay_sgd: mainPay.trim() === "" ? null : Number(mainPay),
        supporting_instructors: supporting.map((s) => ({
          instructor_id: s.instructorId,
          pay_sgd: s.pay.trim() === "" ? null : Number(s.pay),
        })),
        location_id: locationId,
        room_id: roomId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      });
      await onSaved();
    } catch (e) {
      setErr(scheduleErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-soft">
      <h2 className="mb-4 text-sm font-semibold text-ink">Edit class</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cls-type">Class type</Label>
          <select
            id="cls-type"
            value={classTypeId}
            disabled={disabled || saving}
            onChange={(e) => setClassTypeId(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <option value="">Select…</option>
            {classTypes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div />
        <div className="space-y-1.5">
          <Label htmlFor="cls-main-ins">Main instructor</Label>
          <select
            id="cls-main-ins"
            value={mainInstructorId}
            disabled={disabled || saving}
            onChange={(e) => setMainInstructorId(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <option value="">Select…</option>
            {instructors.map((i) => (
              <InstructorOption
                key={i.id}
                instructor={i}
                onLeave={onLeave}
                startTime={startTime}
              />
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cls-main-pay">Main instructor pay (S$)</Label>
          <Input
            id="cls-main-pay"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="Optional"
            value={mainPay}
            disabled={disabled || saving}
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
          disabled={disabled}
          saving={saving}
        />
        <LocationRoomFields
          idPrefix="cls"
          rooms={rooms}
          locationId={locationId}
          roomId={roomId}
          onLocationChange={setLocationId}
          onRoomChange={setRoomId}
          disabled={disabled || saving}
        />
        <div className="space-y-1.5">
          <Label htmlFor="cls-d">Date</Label>
          <Input
            id="cls-d"
            type="date"
            value={date}
            disabled={disabled || saving}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cls-s">Start time</Label>
          <Input
            id="cls-s"
            type="time"
            value={startTime}
            disabled={disabled || saving}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cls-e">End time</Label>
          <Input
            id="cls-e"
            type="time"
            value={endTime}
            disabled={disabled || saving}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>
      {err && (
        <p className="mt-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {err}
        </p>
      )}
      {!disabled && (
        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !classTypeId || !mainInstructorId || !locationId || !roomId}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save changes
          </Button>
        </div>
      )}
    </section>
  );
}

/* ------------------------------- PT session ------------------------------- */

function PtDetail({ id }: { id: string }) {
  const { api } = useWorkspace();
  const [data, setData] = useState<SchedulePtDetail | null>(null);
  const [instructors, setInstructors] = useState<CatalogInstructor[]>([]);
  const [rooms, setRooms] = useState<CatalogRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const [d, ins, rm] = await Promise.all([
        fetchPtDetail(api, id),
        fetchActiveInstructors(api),
        fetchActiveRooms(api),
      ]);
      setData(d);
      setInstructors(ins);
      setRooms(rm);
    } catch (err) {
      setError(detailError(err, "Private session not found."));
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCancelPt() {
    if (!api || !data) return;
    if (
      !confirm(
        "Cancel this private session? Client bookings will be cancelled and credits returned.",
      )
    ) {
      return;
    }
    setCancelBusy(true);
    setActionError(null);
    try {
      // Cancellation is against the PT request, not this session.
      await cancelPtRequest(api, data.pt_request_id);
      await load();
    } catch (err) {
      setActionError(detailError(err, "Private session not found."));
    } finally {
      setCancelBusy(false);
    }
  }

  if (loading) return <LoadingDetail label="private session" />;
  if (error || !data)
    return <ErrorDetail kind="Private session" message={error ?? "Private session not found."} />;

  const state = computeEventState({
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    lifecycle: data.lifecycle,
  });
  const typeLabel = data.session_type === "2on1" ? "2-on-1" : "1-on-1";
  const meta = [
    formatDate(data.starts_at),
    `${formatTime(data.starts_at)} – ${formatTime(data.ends_at)}`,
    data.instructor?.name,
    data.location?.name,
    data.room?.name,
  ].filter((x): x is string => Boolean(x));

  return (
    <DetailFrame>
      <DetailHeader
        badge={<Badge tone="accent">Private session</Badge>}
        state={state}
        title={`Private session · ${typeLabel}`}
        meta={meta}
        action={
          data.lifecycle === "active" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancelPt}
              disabled={cancelBusy}
              className="text-error hover:text-error"
            >
              {cancelBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Ban className="h-4 w-4" />
              )}
              Cancel session
            </Button>
          ) : undefined
        }
      />

      {actionError && (
        <p className="mb-4 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {actionError}
        </p>
      )}

      <section className="mb-6 rounded-xl border border-border bg-card p-5 shadow-soft">
        <h2 className="mb-4 text-sm font-semibold text-ink">Details</h2>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField label="Date" value={formatDate(data.starts_at)} />
          <DetailField
            label="Time"
            value={`${formatTime(data.starts_at)} – ${formatTime(data.ends_at)}`}
          />
          <DetailField label="Format" value={typeLabel} />
          <DetailField label="Instructor" value={data.instructor?.name ?? "—"} />
          <DetailField label="Location" value={data.location?.name ?? "—"} />
          <DetailField label="Room" value={data.room?.name ?? "—"} />
        </dl>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
        <h2 className="mb-3 text-sm font-semibold text-ink">
          Clients ({data.clients.length})
        </h2>
        {data.clients.length === 0 ? (
          <p className="text-sm text-muted">No clients assigned.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.clients.map((cl) => (
              <li
                key={cl.id}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <Link href={`/admin/clients/${cl.id}`} className="text-ink hover:text-accent">
                    {cl.name}
                  </Link>
                  {cl.code && (
                    <div className="text-xs text-muted">Code {cl.code}</div>
                  )}
                </div>
                <PtCheckInBadge state={cl.check_in_state} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <PtEditor data={data} instructors={instructors} rooms={rooms} onSaved={load} />
    </DetailFrame>
  );
}

function PtEditor({
  data,
  instructors,
  rooms,
  onSaved,
}: {
  data: SchedulePtDetail;
  instructors: CatalogInstructor[];
  rooms: CatalogRoom[];
  onSaved: () => void | Promise<void>;
}) {
  const { api } = useWorkspace();
  const disabled = data.lifecycle === "cancelled";

  const [sessionType, setSessionType] = useState<"1on1" | "2on1">(data.session_type);
  const [mainInstructorId, setMainInstructorId] = useState(data.main_instructor_id);
  const [mainPay, setMainPay] = useState(
    data.instructor_pay_sgd == null ? "" : String(data.instructor_pay_sgd),
  );
  const [supporting, setSupporting] = useState<SupportingRow[]>(
    data.supporting_instructors.map((s) => ({
      instructorId: s.id,
      pay: s.pay_sgd == null ? "" : String(s.pay_sgd),
    })),
  );
  const [locationId, setLocationId] = useState(data.location?.id ?? "");
  const [roomId, setRoomId] = useState(data.room?.id ?? "");
  const [date, setDate] = useState(localDay(data.starts_at));
  const [startTime, setStartTime] = useState(toHHMM(data.starts_at));
  const [endTime, setEndTime] = useState(toHHMM(data.ends_at));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onLeave = useInstructorsOnLeave(date);

  // Re-sync when the parent reloads the session.
  useEffect(() => {
    setSessionType(data.session_type);
    setMainInstructorId(data.main_instructor_id);
    setMainPay(data.instructor_pay_sgd == null ? "" : String(data.instructor_pay_sgd));
    setSupporting(
      data.supporting_instructors.map((s) => ({
        instructorId: s.id,
        pay: s.pay_sgd == null ? "" : String(s.pay_sgd),
      })),
    );
    setLocationId(data.location?.id ?? "");
    setRoomId(data.room?.id ?? "");
    setDate(localDay(data.starts_at));
    setStartTime(toHHMM(data.starts_at));
    setEndTime(toHHMM(data.ends_at));
  }, [data]);

  async function handleSave() {
    if (!api) return;
    if (!mainInstructorId || !locationId || !roomId) return;
    if (!date || !startTime || !endTime) return;
    const startsAt = new Date(`${date}T${startTime}:00`);
    const endsAt = new Date(`${date}T${endTime}:00`);
    if (endsAt <= startsAt) {
      setErr("End time must be after start time.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await patchPtSession(api, data.id, {
        // KNOWN GAP: upgrading 1on1 -> 2on1 needs a partner, and this screen has
        // no way to name one. The backend accepts an optional `co_client_id` and
        // otherwise falls back to the request's existing co-client — so an
        // upgrade on a session whose request names nobody fails with
        // `partner_required` and the admin has no field to fix it with.
        // Needs a client picker here, shown only when switching to 2on1.
        session_type: sessionType,
        instructor_id: mainInstructorId,
        instructor_pay_sgd: mainPay.trim() === "" ? null : Number(mainPay),
        supporting_instructors: supporting.map((s) => ({
          instructor_id: s.instructorId,
          pay_sgd: s.pay.trim() === "" ? null : Number(s.pay),
        })),
        location_id: locationId,
        room_id: roomId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      });
      await onSaved();
    } catch (e) {
      setErr(scheduleErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-soft">
      <h2 className="mb-4 text-sm font-semibold text-ink">Edit private session</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pt-type">Format</Label>
          <select
            id="pt-type"
            value={sessionType}
            disabled={disabled || saving}
            onChange={(e) => setSessionType(e.target.value as "1on1" | "2on1")}
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <option value="1on1">1-on-1</option>
            <option value="2on1">2-on-1</option>
          </select>
        </div>
        <div />
        <div className="space-y-1.5">
          <Label htmlFor="pt-main-ins">Main instructor</Label>
          <select
            id="pt-main-ins"
            value={mainInstructorId}
            disabled={disabled || saving}
            onChange={(e) => setMainInstructorId(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <option value="">Select…</option>
            {instructors.map((i) => (
              <InstructorOption
                key={i.id}
                instructor={i}
                onLeave={onLeave}
                startTime={startTime}
              />
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pt-main-pay">Main instructor pay (S$)</Label>
          <Input
            id="pt-main-pay"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="Optional"
            value={mainPay}
            disabled={disabled || saving}
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
          disabled={disabled}
          saving={saving}
        />
        <LocationRoomFields
          idPrefix="pt"
          rooms={rooms}
          locationId={locationId}
          roomId={roomId}
          onLocationChange={setLocationId}
          onRoomChange={setRoomId}
          disabled={disabled || saving}
        />
        <div className="space-y-1.5">
          <Label htmlFor="pt-d">Date</Label>
          <Input
            id="pt-d"
            type="date"
            value={date}
            disabled={disabled || saving}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pt-s">Start time</Label>
          <Input
            id="pt-s"
            type="time"
            value={startTime}
            disabled={disabled || saving}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pt-e">End time</Label>
          <Input
            id="pt-e"
            type="time"
            value={endTime}
            disabled={disabled || saving}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>
      {err && (
        <p className="mt-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {err}
        </p>
      )}
      {!disabled && (
        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !mainInstructorId || !locationId || !roomId}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save changes
          </Button>
        </div>
      )}
    </section>
  );
}

function PtCheckInBadge({ state }: { state: SchedulePtAttendee["check_in_state"] }) {
  if (state === "attended") return <Badge tone="sage">Checked in</Badge>;
  if (state === "no_show") return <Badge tone="error">No-show</Badge>;
  if (state === "pending") return <Badge tone="neutral">Pending</Badge>;
  return null;
}

/* ------------------------------- Workshop ------------------------------- */

function WorkshopDetail({ id }: { id: string }) {
  const { api, accessibleLocations } = useWorkspace();
  const [data, setData] = useState<ApiWorkshopDetail | null>(null);
  const [instructors, setInstructors] = useState<CatalogInstructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const [w, ins] = await Promise.all([
        api.get<ApiWorkshopDetail>(`/portal/admin/workshops/${id}`),
        fetchActiveInstructors(api),
      ]);
      setData(w);
      setInstructors(ins);
    } catch (err) {
      setError(detailError(err, "Workshop not found."));
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCancelWorkshop() {
    if (!api || !data) return;
    if (!confirm("Cancel this workshop? Confirmed workshop bookings will be cancelled.")) {
      return;
    }
    setCancelBusy(true);
    setActionError(null);
    try {
      await api.post(`/portal/admin/schedule/workshops/${data.id}/cancel`);
      await load();
    } catch (err) {
      setActionError(detailError(err, "Workshop not found."));
    } finally {
      setCancelBusy(false);
    }
  }

  if (loading) return <LoadingDetail label="workshop" />;
  if (error || !data) return <ErrorDetail kind="Workshop" message={error ?? "Workshop not found."} />;

  const sortedDays = [...data.days].sort((a, b) => a.ord - b.ord);
  const sortedTiers = [...data.tiers].sort((a, b) => a.ord - b.ord);
  const first = sortedDays[0];
  const last = sortedDays[sortedDays.length - 1];
  const eventState: EventState = first
    ? computeEventState({
        startsAt: first.starts_at,
        endsAt: last!.ends_at,
        lifecycle: data.lifecycle,
      })
    : data.lifecycle === "cancelled"
      ? "cancelled"
      : "scheduled";
  const locName = accessibleLocations.find((l) => l.id === data.location_id)?.name ?? "—";
  const instructorNames = data.instructor_ids
    .map((iid) => instructors.find((i) => i.id === iid)?.name ?? "Unknown")
    .join(" & ");
  const dateMeta = first
    ? sortedDays.length === 1
      ? formatDate(first.starts_at)
      : `${formatDate(first.starts_at)} – ${formatDate(last!.ends_at)}`
    : "No days scheduled";

  return (
    <DetailFrame>
      <DetailHeader
        badge={<Badge tone="warning">Workshop</Badge>}
        state={eventState}
        title={data.name}
        meta={[dateMeta, locName, instructorNames].filter(Boolean)}
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/packages/workshops/${data.id}/edit`}
              className="rounded-md border border-border bg-card px-3 py-1 text-xs text-muted hover:border-accent/40 hover:text-ink"
            >
              Edit content
            </Link>
            {data.lifecycle === "active" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancelWorkshop}
                disabled={cancelBusy}
                className="text-error hover:text-error"
              >
                {cancelBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Ban className="h-4 w-4" />
                )}
                Cancel workshop
              </Button>
            )}
          </div>
        }
      />

      {actionError && (
        <p className="mb-4 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {actionError}
        </p>
      )}

      <section className="mb-6 rounded-xl border border-border bg-card p-5 shadow-soft">
        <h2 className="mb-3 text-sm font-semibold text-ink">Days</h2>
        {sortedDays.length === 0 ? (
          <p className="text-sm text-muted">No days scheduled.</p>
        ) : (
          <ul className="divide-y divide-border">
            {sortedDays.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium text-ink">
                    Day {d.ord} — {formatDate(d.starts_at)}
                  </div>
                  <div className="text-xs text-muted">
                    {formatTime(d.starts_at)} – {formatTime(d.ends_at)}
                  </div>
                </div>
                <div className="text-xs text-muted">
                  Capacity {d.capacity_online + d.capacity_waitlist + d.capacity_buffer}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
        <h2 className="mb-3 text-sm font-semibold text-ink">Pricing tiers</h2>
        {sortedTiers.length === 0 ? (
          <p className="text-sm text-muted">No tiers configured.</p>
        ) : (
          <ul className="divide-y divide-border">
            {sortedTiers.map((t) => (
              <li key={t.id} className="py-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-ink">{t.name}</div>
                  <div className="font-mono text-ink">
                    {formatSgd(Number(t.regular_price_sgd))}
                  </div>
                </div>
                {t.description && <p className="mt-1 text-xs text-muted">{t.description}</p>}
                {t.early_bird_price_sgd && (
                  <p className="mt-1 text-xs text-muted">
                    Early bird {formatSgd(Number(t.early_bird_price_sgd))}
                    {t.early_bird_cutoff_at && ` until ${formatDate(t.early_bird_cutoff_at)}`}
                    {t.early_bird_quota !== null && ` · quota ${t.early_bird_quota}`}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted">
                  Grants access to {t.day_ids.length} day{t.day_ids.length === 1 ? "" : "s"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </DetailFrame>
  );
}

/* ------------------------------- Corporate ------------------------------- */

function CorporateDetail({ id }: { id: string }) {
  const { api, accessibleLocations } = useWorkspace();
  const [data, setData] = useState<ScheduleCorporateSession | null>(null);
  const [pkg, setPkg] = useState<ScheduleCorporatePackageBrief | null>(null);
  const [instructors, setInstructors] = useState<CatalogInstructor[]>([]);
  const [rooms, setRooms] = useState<CatalogRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const [d, ins, rm] = await Promise.all([
        fetchCorporateSession(api, id),
        fetchActiveInstructors(api),
        fetchActiveRooms(api),
      ]);
      setData(d);
      setInstructors(ins);
      setRooms(rm);
      try {
        setPkg(await fetchCorporatePackageBrief(api, d.corporate_package_id));
      } catch {
        setPkg(null);
      }
    } catch (err) {
      setError(detailError(err, "Corporate session not found."));
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingDetail label="corporate session" />;
  if (error || !data)
    return (
      <ErrorDetail kind="Corporate session" message={error ?? "Corporate session not found."} />
    );

  const state = computeEventState({
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    lifecycle: data.lifecycle,
  });
  const mainName =
    instructors.find((i) => i.id === data.main_instructor_id)?.name ?? "Unknown";
  const locationName =
    (data.location_id
      ? accessibleLocations.find((l) => l.id === data.location_id)?.name
      : data.location_text) ?? "—";
  const roomName = data.room_id ? rooms.find((r) => r.id === data.room_id)?.name ?? "—" : "—";
  const meta = [
    formatDate(data.starts_at),
    `${formatTime(data.starts_at)} – ${formatTime(data.ends_at)}`,
    mainName,
    locationName,
    roomName,
  ].filter((x): x is string => Boolean(x));

  return (
    <DetailFrame>
      <DetailHeader
        badge={<Badge tone="neutral">Corporate</Badge>}
        state={state}
        title={pkg?.name ?? "Corporate session"}
        meta={meta}
        action={
          pkg && (
            <Link
              href={`/admin/packages/corporate/${pkg.id}/edit`}
              className="rounded-md border border-border bg-card px-3 py-1 text-xs text-muted hover:border-accent/40 hover:text-ink"
            >
              View package
            </Link>
          )
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Client" value={data.client_name} />
        <Stat
          label="Supporting instructors"
          value={
            data.supporting_instructor_ids.length === 0
              ? "—"
              : String(data.supporting_instructor_ids.length)
          }
          sub={
            data.supporting_instructor_ids.length > 0
              ? data.supporting_instructor_ids
                  .map((sid) => instructors.find((i) => i.id === sid)?.name ?? "Unknown")
                  .join(", ")
              : undefined
          }
        />
        <Stat label="Room" value={roomName} sub={locationName} />
      </div>
      <CorporateEditor
        session={data}
        instructors={instructors}
        rooms={rooms}
        onSaved={load}
      />
    </DetailFrame>
  );
}

function CorporateEditor({
  session,
  instructors,
  rooms,
  onSaved,
}: {
  session: ScheduleCorporateSession;
  instructors: CatalogInstructor[];
  rooms: CatalogRoom[];
  onSaved: () => void | Promise<void>;
}) {
  const { api } = useWorkspace();
  const cancelled = session.lifecycle === "cancelled";

  const initialDate = localDay(session.starts_at);
  const initialStart = toHHMM(session.starts_at);
  const initialEnd = toHHMM(session.ends_at);

  const [clientName, setClientName] = useState(session.client_name);
  const [mainInstructorId, setMainInstructorId] = useState(session.main_instructor_id);
  const [supportingInstructorIds, setSupportingInstructorIds] = useState<string[]>(
    session.supporting_instructor_ids,
  );
  const [locationId, setLocationId] = useState(session.location_id ?? "");
  const [roomId, setRoomId] = useState(session.room_id ?? "");
  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const [saving, setSaving] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onLeave = useInstructorsOnLeave(date);

  useEffect(() => {
    setClientName(session.client_name);
    setMainInstructorId(session.main_instructor_id);
    setSupportingInstructorIds(session.supporting_instructor_ids);
    setLocationId(session.location_id ?? "");
    setRoomId(session.room_id ?? "");
    setDate(localDay(session.starts_at));
    setStartTime(toHHMM(session.starts_at));
    setEndTime(toHHMM(session.ends_at));
  }, [session]);

  useEffect(() => {
    if (!mainInstructorId) return;
    setSupportingInstructorIds((prev) => prev.filter((sid) => sid !== mainInstructorId));
  }, [mainInstructorId]);

  const availableForSupporting = useMemo(
    () =>
      instructors.filter(
        (i) => i.id !== mainInstructorId && !supportingInstructorIds.includes(i.id),
      ),
    [instructors, mainInstructorId, supportingInstructorIds],
  );

  async function handleSave() {
    if (!api) return;
    if (!clientName.trim() || !mainInstructorId || !locationId || !roomId) return;
    if (!date || !startTime || !endTime) return;
    const startsAt = new Date(`${date}T${startTime}:00`);
    const endsAt = new Date(`${date}T${endTime}:00`);
    if (endsAt <= startsAt) {
      setErr("End time must be after start time.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await patchCorporateSession(api, session.id, {
        client_name: clientName.trim(),
        main_instructor_id: mainInstructorId,
        supporting_instructor_ids: supportingInstructorIds,
        location_id: locationId,
        room_id: roomId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      });
      await onSaved();
    } catch (e) {
      setErr(scheduleErrorMessage(e, "Failed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!api) return;
    if (!confirm("Cancel this corporate session?")) return;
    setCancelBusy(true);
    setErr(null);
    try {
      await cancelCorporateSession(api, session.id);
      await onSaved();
    } catch (e) {
      setErr(scheduleErrorMessage(e, "Failed"));
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-soft">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Session</h2>
        {!cancelled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            disabled={cancelBusy || saving}
            className="text-error hover:text-error"
          >
            {cancelBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Ban className="h-4 w-4" />
            )}
            Cancel session
          </Button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cor-client">Client name</Label>
          <Input
            id="cor-client"
            value={clientName}
            disabled={cancelled || saving}
            onChange={(e) => setClientName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cor-main">Main instructor</Label>
          <select
            id="cor-main"
            value={mainInstructorId}
            disabled={cancelled || saving}
            onChange={(e) => setMainInstructorId(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <option value="">Select…</option>
            {instructors.map((i) => (
              <InstructorOption
                key={i.id}
                instructor={i}
                onLeave={onLeave}
                startTime={startTime}
              />
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Supporting instructors</Label>
          <div className="flex flex-wrap items-center gap-2">
            {supportingInstructorIds.map((sid) => {
              const name = instructors.find((i) => i.id === sid)?.name ?? "Unknown";
              return (
                <span
                  key={sid}
                  className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs text-ink"
                >
                  {name}
                  <button
                    type="button"
                    disabled={cancelled || saving}
                    onClick={() =>
                      setSupportingInstructorIds((prev) =>
                        prev.filter((x) => x !== sid),
                      )
                    }
                    className="text-muted hover:text-ink disabled:opacity-50"
                    aria-label={`Remove ${name}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            {!cancelled && availableForSupporting.length > 0 && (
              <select
                value=""
                disabled={saving}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) setSupportingInstructorIds((prev) => [...prev, v]);
                }}
                className="flex h-9 rounded-lg border border-border bg-card px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                <option value="">
                  {supportingInstructorIds.length === 0
                    ? "+ Add supporting instructor"
                    : "+ Add another"}
                </option>
                {availableForSupporting.map((i) => (
                  <InstructorOption
                    key={i.id}
                    instructor={i}
                    onLeave={onLeave}
                    startTime={startTime}
                  />
                ))}
              </select>
            )}
            {supportingInstructorIds.length === 0 && availableForSupporting.length === 0 && (
              <span className="text-xs text-muted">No additional instructors available.</span>
            )}
          </div>
        </div>
        <LocationRoomFields
          idPrefix="cor"
          rooms={rooms}
          locationId={locationId}
          roomId={roomId}
          onLocationChange={setLocationId}
          onRoomChange={setRoomId}
          disabled={cancelled || saving}
        />
        <div className="space-y-1.5">
          <Label htmlFor="cor-d">Date</Label>
          <Input
            id="cor-d"
            type="date"
            value={date}
            disabled={cancelled || saving}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cor-s">Start time</Label>
          <Input
            id="cor-s"
            type="time"
            value={startTime}
            disabled={cancelled || saving}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cor-e">End time</Label>
          <Input
            id="cor-e"
            type="time"
            value={endTime}
            disabled={cancelled || saving}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>
      {err && (
        <p className="mt-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {err}
        </p>
      )}
      {!cancelled && (
        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={
              saving || !clientName.trim() || !mainInstructorId || !locationId || !roomId
            }
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save changes
          </Button>
        </div>
      )}
    </section>
  );
}

function toHHMM(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/* ------------------------------- Shared ------------------------------- */

function detailError(err: unknown, notFoundMsg: string): string {
  if (err instanceof ApiError) return err.status === 404 ? notFoundMsg : `HTTP ${err.status}`;
  return "Network error";
}

function DetailHeader({
  badge,
  state,
  title,
  meta,
  action,
}: {
  badge: React.ReactNode;
  state: EventState;
  title: string;
  meta: string[];
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-6 border-b border-border pb-6">
      <div className="mb-2 flex items-center gap-2">
        {badge}
        <StateBadge state={state} />
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      {meta.length > 0 && <p className="mt-1 text-sm text-muted">{meta.join(" · ")}</p>}
    </header>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-ink">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

// Read-only label/value pair for the Details section. Pass `children` for a
// non-text value (e.g. a Badge); otherwise pass `value`.
function DetailField({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value?: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children ?? value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-muted">{sub}</dd>}
    </div>
  );
}

function LoadingDetail({ label }: { label: string }) {
  return (
    <DetailFrame>
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading {label}…
      </div>
    </DetailFrame>
  );
}

function ErrorDetail({ kind, message }: { kind: string; message: string }) {
  return (
    <DetailFrame>
      <header className="mb-6 border-b border-border pb-6">
        <div className="mb-2 flex items-center gap-2">
          <Badge tone="neutral">{kind}</Badge>
        </div>
        <h1 className="text-2xl font-semibold text-ink">Couldn’t load detail</h1>
      </header>
      <div className="rounded-xl border border-error/30 bg-error/5 p-6 text-center text-sm text-error">
        {message}
      </div>
    </DetailFrame>
  );
}

function DetailFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin/schedule"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Schedule
      </Link>
      {children}
    </div>
  );
}

function StateBadge({ state }: { state: EventState }) {
  if (state === "scheduled") return <Badge tone="accent">Scheduled</Badge>;
  if (state === "ongoing") return <Badge tone="warning">Ongoing</Badge>;
  if (state === "completed") return <Badge tone="sage">Completed</Badge>;
  return <Badge tone="error">Cancelled</Badge>;
}
