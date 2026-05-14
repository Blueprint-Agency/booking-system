"use client";
import Link from "next/link";
import { Plus, MapPin } from "lucide-react";
import { Button, PageHeader, Badge, EmptyState } from "@/components/ui";
import { workshops as seedWorkshops, locations, classTypes } from "@/data";
import { useWorkspace } from "@/lib/workspace-context";
import type { Workshop } from "@/types";

function statusOf(w: Workshop): "upcoming" | "in_progress" | "past" | "cancelled" {
  if (w.lifecycle === "cancelled") return "cancelled";
  const today = new Date().toISOString().slice(0, 10);
  const first = w.days[0]?.date ?? today;
  const last = w.days[w.days.length - 1]?.date ?? today;
  if (last < today) return "past";
  if (first <= today && today <= last) return "in_progress";
  return "upcoming";
}

function dateRangeLabel(w: Workshop): string {
  if (w.days.length === 0) return "No dates";
  if (w.days.length === 1)
    return new Date(w.days[0].date + "T00:00:00").toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  return w.days
    .map((d) =>
      new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })
    )
    .join(" · ");
}

export default function WorkshopsListPage() {
  const { activeLocationId } = useWorkspace();
  const filtered = seedWorkshops.filter(
    (w) => !activeLocationId || w.locationId === activeLocationId
  );
  const upcoming = filtered.filter((w) => statusOf(w) === "upcoming");
  const inProgress = filtered.filter((w) => statusOf(w) === "in_progress");
  const past = filtered.filter((w) => statusOf(w) === "past");
  const cancelled = filtered.filter((w) => statusOf(w) === "cancelled");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Workshops"
        description="Configure upcoming workshops. Each day appears on the schedule automatically once configured."
        actions={
          <Link href="/admin/packages/workshops/new">
            <Button>
              <Plus className="h-4 w-4" /> New workshop
            </Button>
          </Link>
        }
      />

      {filtered.length === 0 && (
        <EmptyState
          title="No workshops yet"
          description="Create one to see it appear on the schedule."
          cta={
            <Link href="/admin/packages/workshops/new">
              <Button>
                <Plus className="h-4 w-4" /> New workshop
              </Button>
            </Link>
          }
        />
      )}

      {inProgress.length > 0 && <Section title="In progress" workshops={inProgress} />}
      {upcoming.length > 0 && <Section title="Upcoming" workshops={upcoming} />}
      {past.length > 0 && (
        <details className="rounded-xl border border-border bg-card p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted">
            Past ({past.length})
          </summary>
          <div className="mt-3">
            <Section title="" workshops={past} />
          </div>
        </details>
      )}
      {cancelled.length > 0 && (
        <details className="rounded-xl border border-border bg-card p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted">
            Cancelled ({cancelled.length})
          </summary>
          <div className="mt-3">
            <Section title="" workshops={cancelled} />
          </div>
        </details>
      )}
    </div>
  );
}

function Section({ title, workshops }: { title: string; workshops: Workshop[] }) {
  return (
    <div className="space-y-2">
      {title && (
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      )}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-soft">
        {workshops.map((w) => (
          <li key={w.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <Link
                href={`/admin/packages/workshops/${w.id}/edit`}
                className="font-medium text-ink hover:text-accent"
              >
                {w.name}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge tone="accent">
                  {classTypes.find((c) => c.id === w.classTypeId)?.name ?? "—"}
                </Badge>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {locations.find((l) => l.id === w.locationId)?.name ?? "—"}
                </span>
                <span>·</span>
                <span>{dateRangeLabel(w)}</span>
                <span>·</span>
                <span>
                  {w.days.length} day{w.days.length === 1 ? "" : "s"}
                </span>
                <span>·</span>
                <span>
                  {w.tiers.length} tier{w.tiers.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
            <Link href={`/admin/packages/workshops/${w.id}/edit`}>
              <Button size="sm" variant="ghost">
                Edit
              </Button>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
