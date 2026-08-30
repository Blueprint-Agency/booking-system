"use client";
import { useState } from "react";
import { Pencil, Archive, RotateCcw, Plus } from "lucide-react";
import { Dialog, Button, Badge } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { LocationFormDialog } from "@/components/locations/location-form-dialog";
import type { Location } from "@/types";

export function ManageLocationsDialog({ onClose }: { onClose: () => void }) {
  const { locations, addLocation, updateLocation, archiveLocation, restoreLocation } =
    useWorkspace();
  const [editing, setEditing] = useState<Location | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()} title="Manage locations">
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> Add location
            </Button>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {locations.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted">
                No locations yet.
              </li>
            )}
            {locations.map((loc) => (
              <li
                key={loc.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                    <span className="font-medium">{loc.name}</span>
                    {loc.archivedAt && <Badge tone="neutral">Archived</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted">{loc.address}</div>
                </div>
                <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(loc)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  {loc.archivedAt ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => restoreLocation(loc.id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => archiveLocation(loc.id)}
                    >
                      <Archive className="h-3.5 w-3.5" /> Archive
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
      {creating && (
        <LocationFormDialog
          location={null}
          onClose={() => setCreating(false)}
          onSave={async (loc) => {
            await addLocation(loc);
            setCreating(false);
          }}
        />
      )}
      {editing && (
        <LocationFormDialog
          location={editing}
          onClose={() => setEditing(null)}
          onSave={async (loc) => {
            await updateLocation(loc);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
