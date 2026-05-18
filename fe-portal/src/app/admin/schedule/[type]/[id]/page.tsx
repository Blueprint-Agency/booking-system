"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { computeEventState } from "@/lib/event-state";
import { formatDate, formatTime, formatSgd } from "@/lib/formatters";
import type { EventState } from "@/types";

interface ApiInstructor {
  id: string;
  name: string;
}

interface ApiClassType {
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
  class_type_id: string;
  location_id: string;
  description_html: string | null;
  lifecycle: "active" | "cancelled";
  days: ApiWorkshopDay[];
  tiers: ApiWorkshopTier[];
  instructor_ids: string[];
}

export default function SessionDetailPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = use(params);

  if (type === "workshop") return <WorkshopDetail id={id} />;
  if (type === "class" || type === "pt")
    return (
      <PlaceholderDetail
        kind={type === "class" ? "Class" : "Private session"}
        message={`Detail view for ${type === "class" ? "classes" : "private sessions"} is not yet wired to the backend.`}
      />
    );
  return <PlaceholderDetail kind="Unknown" message="Unknown session type." />;
}

function WorkshopDetail({ id }: { id: string }) {
  const { api, accessibleLocations } = useWorkspace();
  const [data, setData] = useState<ApiWorkshopDetail | null>(null);
  const [instructors, setInstructors] = useState<ApiInstructor[]>([]);
  const [classTypes, setClassTypes] = useState<ApiClassType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [w, ins, ct] = await Promise.all([
          api.get<ApiWorkshopDetail>(`/portal/admin/workshops/${id}`),
          api.get<{ instructors: ApiInstructor[] }>("/portal/admin/instructors"),
          api.get<{ class_types: ApiClassType[] }>("/portal/admin/class-types"),
        ]);
        if (cancelled) return;
        setData(w);
        setInstructors(ins.instructors);
        setClassTypes(ct.class_types);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.status === 404
              ? "Workshop not found."
              : `HTTP ${err.status}`
            : "Network error",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  if (loading) {
    return (
      <DetailFrame>
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading workshop…
        </div>
      </DetailFrame>
    );
  }

  if (error || !data) {
    return (
      <DetailFrame>
        <div className="rounded-xl border border-error/30 bg-error/5 p-6 text-center">
          <p className="text-sm text-error">{error ?? "Workshop not found."}</p>
        </div>
      </DetailFrame>
    );
  }

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
  const locName =
    accessibleLocations.find((l) => l.id === data.location_id)?.name ?? "—";
  const ctName = classTypes.find((c) => c.id === data.class_type_id)?.name ?? "—";
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
      <header className="mb-6 border-b border-border pb-6">
        <div className="mb-2 flex items-center gap-2">
          <Badge tone="warning">Workshop</Badge>
          <StateBadge state={eventState} />
          <Link
            href={`/admin/packages/workshops/${data.id}/edit`}
            className="ml-auto rounded-md border border-border bg-card px-3 py-1 text-xs text-muted hover:border-accent/40 hover:text-ink"
          >
            Edit content
          </Link>
        </div>
        <h1 className="text-2xl font-semibold text-ink">{data.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {[dateMeta, ctName, locName, instructorNames].filter(Boolean).join(" · ")}
        </p>
      </header>

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
                {t.description && (
                  <p className="mt-1 text-xs text-muted">{t.description}</p>
                )}
                {t.early_bird_price_sgd && (
                  <p className="mt-1 text-xs text-muted">
                    Early bird {formatSgd(Number(t.early_bird_price_sgd))}
                    {t.early_bird_cutoff_at &&
                      ` until ${formatDate(t.early_bird_cutoff_at)}`}
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

function PlaceholderDetail({ kind, message }: { kind: string; message: string }) {
  return (
    <DetailFrame>
      <header className="mb-6 border-b border-border pb-6">
        <div className="mb-2 flex items-center gap-2">
          <Badge tone="neutral">{kind}</Badge>
        </div>
        <h1 className="text-2xl font-semibold text-ink">Detail view coming soon</h1>
      </header>
      <div className="rounded-xl border border-border bg-paper p-6 text-center text-sm text-muted">
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
