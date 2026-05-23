"use client";
import { useState, useRef, useEffect } from "react";
import { MapPin, Check, Plus, Settings, ChevronDown } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { LocationFormDialog } from "@/components/locations/location-form-dialog";
import { ManageLocationsDialog } from "./manage-locations-dialog";

export function WorkspaceSwitcher() {
  const {
    role,
    accessibleLocations,
    activeLocation,
    setActiveLocationId,
    addLocation,
  } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-paper px-3 text-sm text-ink hover:border-accent/40"
      >
        <MapPin className="h-4 w-4 text-muted" />
        <span className="font-medium">{activeLocation?.name ?? "No workspace"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-border bg-card shadow-modal">
          <div className="p-1">
            {accessibleLocations.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted">No accessible locations.</div>
            )}
            {accessibleLocations.map((loc) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => {
                  setActiveLocationId(loc.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-paper"
              >
                <span className="flex-1 truncate">{loc.name}</span>
                {activeLocation?.id === loc.id && <Check className="h-4 w-4 text-accent" />}
              </button>
            ))}
          </div>

          {role === "superadmin" && (
            <>
              <div className="border-t border-border" />
              <div className="p-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(true);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-paper"
                >
                  <Plus className="h-4 w-4 text-muted" /> Add location
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowManage(true);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-paper"
                >
                  <Settings className="h-4 w-4 text-muted" /> Manage locations
                </button>
              </div>
            </>
          )}
          {role === "admin" && (
            <>
              <div className="border-t border-border" />
              <p className="px-3 py-2 text-[11px] text-muted">
                Contact your superadmin to request more workspace access.
              </p>
            </>
          )}
        </div>
      )}

      {showCreate && (
        <LocationFormDialog
          location={null}
          onClose={() => setShowCreate(false)}
          onSave={async (loc) => {
            await addLocation(loc);
            setShowCreate(false);
          }}
        />
      )}
      {showManage && <ManageLocationsDialog onClose={() => setShowManage(false)} />}
    </div>
  );
}
