"use client";
import { useState } from "react";
import { MapPin, Lock } from "lucide-react";
import { Button } from "@/components/ui";
import { LocationFormDialog } from "@/components/locations/location-form-dialog";
import { useWorkspace } from "@/lib/workspace-context";

export function LocationGate({ children }: { children: React.ReactNode }) {
  const { role, accessibleLocations, addLocation, setActiveLocationId } = useWorkspace();
  const [open, setOpen] = useState(false);

  if (accessibleLocations.length > 0) return <>{children}</>;

  if (role === "superadmin") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-lg rounded-2xl border border-border bg-card p-8 shadow-soft">
          <MapPin className="mb-4 h-8 w-8 text-accent" />
          <h2 className="mb-2 text-lg font-semibold text-ink">Add your first location</h2>
          <p className="mb-6 text-sm text-muted">
            Workspace-level features (Schedule, Workshops, Check-in, Inbox) need at least
            one studio location. Add one to start configuring the rest of the system.
          </p>
          <Button onClick={() => setOpen(true)}>Add location</Button>
          {open && (
            <LocationFormDialog
              location={null}
              onClose={() => setOpen(false)}
              onSave={(loc) => {
                addLocation(loc);
                setActiveLocationId(loc.id);
                setOpen(false);
              }}
            />
          )}
        </div>
      </div>
    );
  }

  // role === "admin" (or instructor, treated the same — no workspace access)
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-lg rounded-2xl border border-border bg-card p-8 shadow-soft">
        <Lock className="mb-4 h-8 w-8 text-muted" />
        <h2 className="mb-2 text-lg font-semibold text-ink">No workspace access</h2>
        <p className="text-sm text-muted">
          Your account isn&apos;t granted to any location yet. Contact your superadmin to
          be added to one or more workspaces.
        </p>
      </div>
    </div>
  );
}
