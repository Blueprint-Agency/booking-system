"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { computeEventState } from "@/lib/event-state";
import { formatDate, formatTime, formatSgd } from "@/lib/formatters";
import type { EventState } from "@/types";

interface NamedRef {
  id: string;
  name: string;
}

interface ApiInstructor {
  id: string;
  name: string;
}

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

interface ApiClassDetail {
  id: string;
  lifecycle: "active" | "cancelled";
  starts_at: string;
  ends_at: string;
  class_type: NamedRef | null;
  instructor: NamedRef | null;
  location: NamedRef | null;
  room: NamedRef | null;
  capacity_online: number;
  capacity_waitlist: number;
  capacity_buffer: number;
  credit_cost: number;
  booked_count: number;
}

interface ApiPtDetail {
  id: string;
  lifecycle: "active" | "cancelled";
  starts_at: string;
  ends_at: string;
  session_type: "1on1" | "2on1";
  instructor: NamedRef | null;
  location: NamedRef | null;
  capacity_online: number;
  capacity_waitlist: number;
  capacity_buffer: number;
  clients: NamedRef[];
}

export default function SessionDetailPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = use(params);

  if (type === "workshop") return <WorkshopDetail id={id} />;
  if (type === "class") return <ClassDetail id={id} />;
  if (type === "pt") return <PtDetail id={id} />;
  return <ErrorDetail kind="Unknown" message="Unknown session type." />;
}

/* ------------------------------- Class ------------------------------- */

function ClassDetail({ id }: { id: string }) {
  const { api } = useWorkspace();
  const [data, setData] = useState<ApiClassDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<ApiClassDetail>(`/portal/admin/schedule/classes/${id}`));
    } catch (err) {
      setError(detailError(err, "Class not found."));
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingDetail label="class" />;
  if (error || !data) return <ErrorDetail kind="Class" message={error ?? "Class not found."} />;

  const state = computeEventState({
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    lifecycle: data.lifecycle,
  });
  const capacity = data.capacity_online + data.capacity_waitlist + data.capacity_buffer;
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
        badge={<Badge tone="cyan">Class</Badge>}
        state={state}
        title={data.class_type?.name ?? "Class"}
        meta={meta}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Booked" value={`${data.booked_count} / ${capacity}`} />
        <Stat label="Credit cost" value={`${data.credit_cost} credit${data.credit_cost === 1 ? "" : "s"}`} />
        <Stat label="Capacity split" value={`${data.capacity_online} / ${data.capacity_waitlist} / ${data.capacity_buffer}`} sub="online / waitlist / buffer" />
      </div>
    </DetailFrame>
  );
}

/* ------------------------------- PT session ------------------------------- */

function PtDetail({ id }: { id: string }) {
  const { api } = useWorkspace();
  const [data, setData] = useState<ApiPtDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<ApiPtDetail>(`/portal/admin/schedule/pt/${id}`));
    } catch (err) {
      setError(detailError(err, "Private session not found."));
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

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
  ].filter((x): x is string => Boolean(x));

  return (
    <DetailFrame>
      <DetailHeader
        badge={<Badge tone="accent">Private session</Badge>}
        state={state}
        title={`Private session · ${typeLabel}`}
        meta={meta}
      />
      <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
        <h2 className="mb-3 text-sm font-semibold text-ink">
          Clients ({data.clients.length})
        </h2>
        {data.clients.length === 0 ? (
          <p className="text-sm text-muted">No clients assigned.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.clients.map((cl) => (
              <li key={cl.id} className="py-2 text-sm text-ink">
                <Link href={`/admin/clients/${cl.id}`} className="hover:text-accent">
                  {cl.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </DetailFrame>
  );
}

/* ------------------------------- Workshop ------------------------------- */

function WorkshopDetail({ id }: { id: string }) {
  const { api, accessibleLocations } = useWorkspace();
  const [data, setData] = useState<ApiWorkshopDetail | null>(null);
  const [instructors, setInstructors] = useState<ApiInstructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [w, ins] = await Promise.all([
          api.get<ApiWorkshopDetail>(`/portal/admin/workshops/${id}`),
          api.get<{ instructors: ApiInstructor[] }>("/portal/admin/instructors"),
        ]);
        if (cancelled) return;
        setData(w);
        setInstructors(ins.instructors);
      } catch (err) {
        if (cancelled) return;
        setError(detailError(err, "Workshop not found."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, id]);

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
          <Link
            href={`/admin/packages/workshops/${data.id}/edit`}
            className="rounded-md border border-border bg-card px-3 py-1 text-xs text-muted hover:border-accent/40 hover:text-ink"
          >
            Edit content
          </Link>
        }
      />

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
