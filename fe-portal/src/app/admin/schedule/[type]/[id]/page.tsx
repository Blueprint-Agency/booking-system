import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui";
import {
  classInstances,
  workshops,
  ptSessions,
  bookings,
  clients,
  ratings,
} from "@/data";
import { computeEventState } from "@/lib/event-state";
import { instructorName, locationName, classTypeName } from "@/lib/schedule-helpers";
import { maxCapacity } from "@/lib/capacity";
import { formatDate, formatTime, formatDuration, formatSgd } from "@/lib/formatters";
import type { Capacity } from "@/types";
import { ClassDetailClient } from "@/components/schedule/class-detail-client";
import { WorkshopDetailClient } from "@/components/schedule/workshop-detail-client";
import { PtDetailClient } from "@/components/schedule/pt-detail-client";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = await params;

  if (type === "class") {
    const cls = classInstances.find((c) => c.id === id);
    if (!cls) notFound();
    const eventState = computeEventState({
      startsAt: cls.startsAt,
      endsAt: cls.endsAt,
      lifecycle: cls.lifecycle,
    });
    const roster = bookings
      .filter((b) => b.classId === cls.id)
      .map((b) => ({ booking: b, client: clients.find((c) => c.id === b.clientId)! }));
    const myRatings = ratings.filter((r) => r.classId === cls.id);
    return (
      <DetailShell
        backHref="/admin/schedule"
        kindBadge={<Badge tone="cyan">Class</Badge>}
        eventState={eventState}
        title={classTypeName(cls.classTypeId)}
        meta={[
          formatDate(cls.startsAt) + ", " + formatTime(cls.startsAt),
          formatDuration(cls.startsAt, cls.endsAt),
          locationName(cls.locationId),
          instructorName(cls.instructorId),
          `${cls.creditCost} credit${cls.creditCost === 1 ? "" : "s"}`,
          cls.difficulty[0].toUpperCase() + cls.difficulty.slice(1),
        ]}
        capacity={cls.capacity}
      >
        <ClassDetailClient classInstance={cls} roster={roster} ratings={myRatings} />
      </DetailShell>
    );
  }

  if (type === "workshop") {
    const w = workshops.find((x) => x.id === id);
    if (!w || w.days.length === 0) notFound();
    const first = w.days[0];
    const last = w.days[w.days.length - 1];
    const startsAt = `${first.date}T${first.startTime}:00.000Z`;
    const endsAt = `${last.date}T${last.endTime}:00.000Z`;
    const eventState = computeEventState({
      startsAt,
      endsAt,
      lifecycle: w.lifecycle,
    });
    const tiers = w.tiers;
    const roster = bookings
      .filter((b) => b.workshopId === w.id)
      .map((b) => ({
        booking: b,
        client: clients.find((c) => c.id === b.clientId)!,
        tier: tiers.find((t) => t.id === b.workshopTierId),
      }));
    const myRatings = ratings.filter((r) => r.workshopId === w.id);
    const dateMeta =
      w.days.length === 1 ? formatDate(startsAt) : `${formatDate(startsAt)} – ${formatDate(endsAt)}`;
    return (
      <DetailShell
        backHref="/admin/schedule"
        kindBadge={<Badge tone="warning">Workshop</Badge>}
        eventState={eventState}
        title={w.name}
        editHref={`/admin/packages/workshops/${w.id}/edit`}
        meta={[
          dateMeta,
          locationName(w.locationId),
          w.instructorIds.map(instructorName).join(" & "),
        ]}
      >
        <WorkshopDetailClient workshop={w} tiers={tiers} roster={roster} ratings={myRatings} />
      </DetailShell>
    );
  }

  if (type === "pt") {
    const s = ptSessions.find((x) => x.id === id);
    if (!s) notFound();
    const eventState = computeEventState({
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      lifecycle: "active",
    });
    const roster = bookings
      .filter((b) => b.ptSessionId === s.id)
      .map((b) => ({ booking: b, client: clients.find((c) => c.id === b.clientId)! }));
    return (
      <DetailShell
        backHref="/admin/schedule"
        kindBadge={<Badge tone="accent">Private</Badge>}
        eventState={eventState}
        title={`${s.sessionType === "1on1" ? "1-on-1" : "2-on-1"} private session`}
        meta={[
          formatDate(s.startsAt) + ", " + formatTime(s.startsAt),
          formatDuration(s.startsAt, s.endsAt),
          locationName(s.locationId),
          instructorName(s.instructorId),
        ]}
        capacity={s.capacity}
      >
        <PtDetailClient ptSession={s} roster={roster} />
      </DetailShell>
    );
  }

  notFound();
}

function DetailShell({
  backHref,
  kindBadge,
  eventState,
  title,
  meta,
  editHref,
  capacity,
  children,
}: {
  backHref: string;
  kindBadge: React.ReactNode;
  eventState: ReturnType<typeof computeEventState>;
  title: string;
  meta: string[];
  editHref?: string;
  capacity?: Capacity;
  children: React.ReactNode;
}) {
  const stateBadge =
    eventState === "scheduled" ? (
      <Badge tone="accent">Scheduled</Badge>
    ) : eventState === "ongoing" ? (
      <Badge tone="warning">Ongoing</Badge>
    ) : eventState === "completed" ? (
      <Badge tone="sage">Completed</Badge>
    ) : (
      <Badge tone="error">Cancelled</Badge>
    );
  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={backHref}
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Schedule
      </Link>
      <header className="mb-6 border-b border-border pb-6">
        <div className="mb-2 flex items-center gap-2">
          {kindBadge}
          {stateBadge}
          {editHref && (
            <Link
              href={editHref}
              className="ml-auto rounded-md border border-border bg-card px-3 py-1 text-xs text-muted hover:border-accent/40 hover:text-ink"
            >
              Edit content
            </Link>
          )}
        </div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        <p className="mt-1 text-sm text-muted">{meta.filter(Boolean).join(" · ")}</p>
        {capacity && (
          <div className="mt-4 inline-flex flex-wrap items-center gap-4 rounded-lg border border-border bg-paper px-4 py-2 text-xs">
            <span className="font-semibold uppercase tracking-wider text-muted">
              Capacity breakdown
            </span>
            <span>
              Waitlist <strong className="text-ink">{capacity.waitlist}</strong>
            </span>
            <span>
              Online <strong className="text-ink">{capacity.onlineBooking}</strong>
            </span>
            <span>
              Buffer <strong className="text-ink">{capacity.buffer}</strong>
            </span>
            <span className="text-muted">
              Max <strong className="text-ink">{maxCapacity(capacity)}</strong>
            </span>
          </div>
        )}
      </header>
      {children}
    </div>
  );
}
