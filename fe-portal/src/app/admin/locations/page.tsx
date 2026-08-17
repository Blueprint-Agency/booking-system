"use client";
import { useState } from "react";
import { Plus, Archive, RotateCcw, MapPin, Phone, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, PageHeader, Badge, EmptyState, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { LocationFormDialog } from "@/components/locations/location-form-dialog";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import type { Location } from "@/types";

export default function LocationsPage() {
  const {
    role,
    api,
    locations,
    addLocation,
    updateLocation,
    archiveLocation,
    restoreLocation,
    refresh,
  } = useWorkspace();
  const [editing, setEditing] = useState<Location | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"active" | "archived">("active");

  const active = locations.filter((l) => !l.archivedAt);
  const archived = locations.filter((l) => l.archivedAt);

  async function handleSave(loc: Location) {
    try {
      if (locations.some((l) => l.id === loc.id)) {
        await updateLocation(loc);
        toast.success("Location updated.");
      } else {
        await addLocation(loc);
        toast.success("Location created.");
      }
      setEditing(null);
      setCreating(false);
    } catch (err) {
      const msg =
        err instanceof ApiError ? `Save failed (HTTP ${err.status}).` : "Save failed.";
      toast.error(msg);
    }
  }

  async function toggleArchive(loc: Location) {
    try {
      if (loc.archivedAt) {
        await restoreLocation(loc.id);
        toast.success("Location restored.");
      } else if (await archiveLocation(loc.id)) {
        toast.success("Location archived.");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error("Cannot archive: location is referenced by active sessions.");
      } else {
        toast.error("Archive failed.");
      }
    }
  }

  async function handleDelete(loc: Location) {
    if (!api) return;
    if (!window.confirm("Delete this location? It will be removed from the UI and cannot be restored.")) {
      return;
    }
    try {
      await api.del(`/portal/admin/locations/${loc.id}`);
      await refresh();
      toast.success("Location deleted.");
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        toast.error(body?.message ?? body?.error ?? `Delete failed (HTTP ${err.status}).`);
      } else {
        toast.error("Delete failed.");
      }
    }
  }

  if (role !== "superadmin") {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Locations"
          description="Studio addresses surfaced in the schedule, session detail pages, and on the customer app."
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
        description="Studio addresses surfaced in the schedule, session detail pages, and on the customer app."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add location
          </Button>
        }
      />

      {active.length + archived.length > 0 && (
        <Tabs value={view} onValueChange={(v) => setView(v as "active" | "archived")} className="mb-6">
          <TabsList>
            <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
            <TabsTrigger value="archived">Archived ({archived.length})</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

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
      ) : view === "active" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {active.map((loc) => (
            <LocationCard
              key={loc.id}
              location={loc}
              onEdit={() => setEditing(loc)}
              onArchive={() => toggleArchive(loc)}
            />
          ))}
        </div>
      ) : archived.length === 0 ? (
        <EmptyState
          title="No archived locations"
          description="Archived locations will appear here."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {archived.map((loc) => (
            <LocationCard
              key={loc.id}
              location={loc}
              onEdit={() => setEditing(loc)}
              onArchive={() => toggleArchive(loc)}
              onDelete={() => handleDelete(loc)}
            />
          ))}
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
  onDelete,
}: {
  location: Location;
  onEdit: () => void;
  onArchive: () => void;
  onDelete?: () => void;
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
          {isArchived && onDelete && (
            <Button size="sm" variant="ghost" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          )}
        </div>
      </div>
      <ul className="space-y-1.5 text-sm text-muted">
        {location.address && (
          <li className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{location.address}</span>
          </li>
        )}
        {location.phone && (
          <li className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono text-xs">{location.phone}</span>
          </li>
        )}
        {location.gmapsUrl && (
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
        )}
      </ul>
    </div>
  );
}
