"use client";
import { useState } from "react";
import { Plus, Archive, RotateCcw, MapPin, Phone, ExternalLink } from "lucide-react";
import { Button, PageHeader, Badge, EmptyState } from "@/components/ui";
import { locations as seedLocations } from "@/data";
import { LocationFormDialog } from "@/components/locations/location-form-dialog";
import { useWorkspace } from "@/lib/workspace-context";
import type { Location } from "@/types";

export default function LocationsPage() {
  const { role } = useWorkspace();
  const [locations, setLocations] = useState<Location[]>(seedLocations);
  const [editing, setEditing] = useState<Location | null>(null);
  const [creating, setCreating] = useState(false);

  const active = locations.filter((l) => !l.archivedAt);
  const archived = locations.filter((l) => l.archivedAt);

  function handleSave(loc: Location) {
    setLocations((prev) =>
      prev.some((l) => l.id === loc.id) ? prev.map((l) => (l.id === loc.id ? loc : l)) : [...prev, loc]
    );
    setEditing(null);
    setCreating(false);
  }

  function toggleArchive(id: string) {
    setLocations((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, archivedAt: l.archivedAt ? null : new Date().toISOString() } : l
      )
    );
  }

  if (role !== "superadmin") {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Locations"
          description="Studio addresses surfaced in the schedule, session detail pages, and on the client app."
        />
        <div className="rounded-xl border border-border bg-card px-6 py-12 text-center shadow-soft">
          <h2 className="text-sm font-semibold text-ink">Superadmin only</h2>
          <p className="mt-1 text-xs text-muted">
            Only superadmins can manage studio locations.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Locations"
        description="Studio addresses surfaced in the schedule, session detail pages, and on the client app."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add location
          </Button>
        }
      />

      {active.length === 0 && archived.length === 0 ? (
        <EmptyState
          title="No locations yet"
          description="Add your first studio location to start scheduling classes."
          cta={
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Add location
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {active.map((loc) => (
            <LocationCard
              key={loc.id}
              location={loc}
              onEdit={() => setEditing(loc)}
              onArchive={() => toggleArchive(loc.id)}
            />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            Archived
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {archived.map((loc) => (
              <LocationCard
                key={loc.id}
                location={loc}
                onEdit={() => setEditing(loc)}
                onArchive={() => toggleArchive(loc.id)}
              />
            ))}
          </div>
        </div>
      )}

      {(creating || editing) && (
        <LocationFormDialog
          location={editing}
          onSave={handleSave}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function LocationCard({
  location,
  onEdit,
  onArchive,
}: {
  location: Location;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const isArchived = !!location.archivedAt;
  return (
    <div
      className={`rounded-xl border bg-card p-5 shadow-soft transition ${
        isArchived ? "border-border opacity-70" : "border-border hover:border-accent/40"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-ink">{location.name}</h3>
          {isArchived && (
            <Badge tone="neutral" className="mt-1">
              Archived
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          {!isArchived && (
            <Button size="sm" variant="ghost" onClick={onEdit}>
              Edit
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onArchive}>
            {isArchived ? (
              <>
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </>
            ) : (
              <>
                <Archive className="h-3.5 w-3.5" /> Archive
              </>
            )}
          </Button>
        </div>
      </div>
      <ul className="space-y-1.5 text-sm text-muted">
        <li className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{location.address}</span>
        </li>
        <li className="flex items-center gap-2">
          <Phone className="h-3.5 w-3.5 shrink-0" />
          <span className="font-mono text-xs">{location.phone}</span>
        </li>
        <li className="flex items-center gap-2">
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          <a
            href={location.gmapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-xs text-accent hover:underline"
          >
            View on Google Maps
          </a>
        </li>
      </ul>
    </div>
  );
}
