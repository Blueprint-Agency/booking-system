import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui";
import {
  classInstances,
  workshops,
  workshopTiers,
  ptSessions,
  bookings,
  clients,
  ratings,
} from "@/data";
import { computeEventState } from "@/lib/event-state";
import { instructorName, locationName, classTypeName } from "@/lib/schedule-helpers";
import { formatDate, formatTime, formatDuration, formatSgd } from "@/lib/formatters";
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
        ]}
      >
        <ClassDetailClient classInstance={cls} roster={roster} ratings={myRatings} />
      </DetailShell>
    );
  }

  if (type === "workshop") {
    const w = workshops.find((x) => x.id === id);
    if (!w) notFound();
    const eventState = computeEventState({
      startsAt: w.startsAt,
      endsAt: w.endsAt,
      lifecycle: w.lifecycle,
    });
    const tiers = workshopTiers.filter((t) => t.workshopId === w.id);
    const roster = bookings
      .filter((b) => b.workshopId === w.id)
      .map((b) => ({
        booking: b,
        client: clients.find((c) => c.id === b.clientId)!,
        tier: tiers.find((t) => t.id === b.workshopTierId),
      }));
    const myRatings = ratings.filter((r) => r.workshopId === w.id);
    return (
      <DetailShell
        backHref="/admin/schedule"
        kindBadge={<Badge tone="warning">Workshop</Badge>}
        eventState={eventState}
        title={w.name}
        meta={[
          formatDate(w.startsAt) + " – " + formatDate(w.endsAt),
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
  children,
}: {
  backHref: string;
  kindBadge: React.ReactNode;
  eventState: ReturnType<typeof computeEventState>;
  title: string;
  meta: string[];
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
        </div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        <p className="mt-1 text-sm text-muted">{meta.filter(Boolean).join(" · ")}</p>
      </header>
      {children}
    </div>
  );
}
