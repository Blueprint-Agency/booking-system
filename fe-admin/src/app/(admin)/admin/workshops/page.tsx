"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Star } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, Button, Badge, EmptyState } from "@/components/ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { LocationFilterChip } from "@/components/filters/location-filter-chip";
import { formatDateTime } from "@/lib/formatters";
import type { Session } from "@/types";

export default function WorkshopsPage() {
  const sessions = useAdminState((s) => s.sessions);
  const instructors = useAdminState((s) => s.instructors);
  const locations = useAdminState((s) => s.locations);
  const [locFilter, setLocFilter] = useState<string | null>(null);

  const workshops = useMemo(
    () =>
      sessions.filter(
        (s) => s.type === "workshop" && (!locFilter || s.locationId === locFilter),
      ),
    [sessions, locFilter],
  );
  const instructorById = useMemo(
    () => new Map(instructors.map((i) => [i.id, i])),
    [instructors],
  );
  const locationById = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations],
  );

  const columns: DataTableColumn<Session>[] = [
    {
      key: "name",
      header: "Workshop",
      sortable: true,
      sortValue: (s) => s.name,
      cell: (s) => (
        <Link href={`/admin/workshops/${s.id}`} className="font-medium text-ink hover:text-accent">
          {s.name}
          {s.workshopFeatured && (
            <Star className="ml-1 inline h-3 w-3 -translate-y-0.5 fill-accent text-accent" />
          )}
        </Link>
      ),
    },
    {
      key: "when",
      header: "When",
      sortable: true,
      sortValue: (s) => `${s.date}T${s.time}`,
      cell: (s) => (
        <span className="text-sm text-muted">
          {formatDateTime(`${s.date}T${s.time}:00`)}
        </span>
      ),
    },
    {
      key: "location",
      header: "Location",
      cell: (s) => (
        <span className="text-sm text-muted">
          {s.locationId ? locationById.get(s.locationId)?.name ?? "â€”" : "â€”"}
        </span>
      ),
    },
    {
      key: "instructor",
      header: "Instructor",
      cell: (s) => (
        <span className="text-sm text-muted">
          {instructorById.get(s.instructorId)?.name ?? "â€”"}
        </span>
      ),
    },
    {
      key: "tiers",
      header: "Tiers",
      align: "right",
      cell: (s) => (
        <span className="text-sm tabular-nums text-muted">
          {s.workshopTiers?.length ?? s.workshopPackages?.length ?? 0}
        </span>
      ),
    },
    {
      key: "capacity",
      header: "Capacity",
      align: "right",
      cell: (s) => (
        <span className="text-sm tabular-nums">
          {s.bookedCount}/{s.capacity}
        </span>
      ),
    },
    {
      key: "status",
      header: "",
      cell: (s) =>
        s.workshopPublished ? (
          <Badge tone="sage">Published</Badge>
        ) : (
          <Badge tone="neutral">Draft</Badge>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Workshops"
        description="One-off paid sessions with tiered pricing."
        actions={
          <Link href="/admin/workshops/new">
            <Button>
              <Plus className="mr-1 h-4 w-4" /> New workshop
            </Button>
          </Link>
        }
      />
      <div className="mt-4">
        <LocationFilterChip value={locFilter} onChange={setLocFilter} />
      </div>
      <div className="mt-4">
        <DataTable<Session>
          rows={workshops}
          columns={columns}
          rowKey={(s) => s.id}
          empty={
            <EmptyState
              title="No workshops yet"
              description="Create your first paid workshop with tiered pricing."
              cta={{ href: "/admin/workshops/new", label: "Create workshop" }}
            />
          }
        />
      </div>
    </>
  );
}
