"use client";
import { useState, useRef, useEffect } from "react";
import { MapPin, Check, Plus, Settings, ChevronDown, Info } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { LocationFormDialog } from "@/components/locations/location-form-dialog";
import { ManageLocationsDialog } from "./manage-locations-dialog";

/** Surfaces whose data re-scopes with the active location — the `workspaceScoped`
 * nav items shown in the sidebar's "This location" zone. Keep in sync with nav-items.ts. */
const SCOPED_SURFACES = ["Schedule", "Check-in", "PT Requests", "Rooms"];

/**
 * Small "(i)" affordance next to the switcher that explains what a location
 * switch actually affects — most surfaces (packages, clients, staff, payroll,
 * policies) are shared, so it's easy to assume switching changes more than it
 * does. Opens on hover (desktop), tap (mobile), or keyboard activation; the
 * description is also wired via aria-describedby so screen readers get it on focus.
 */
function LocationScopeInfo() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="What changes when you switch location"
        aria-expanded={open}
        aria-describedby="location-scope-info"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-9 w-7 items-center justify-center rounded-md text-muted transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none"
      >
        <Info className="h-4 w-4" />
      </button>

      {open && (
        <div
          id="location-scope-info"
          role="tooltip"
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-border bg-card p-3.5 text-left shadow-modal"
        >
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            Switching location affects
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {SCOPED_SURFACES.map((label) => (
              <span
                key={label}
                className="inline-flex items-center rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent"
              >
                {label}
              </span>
            ))}
          </div>
          <div className="border-t border-border" />
          <p className="mt-2.5 text-xs leading-relaxed text-muted">
            Everything else — packages, clients, staff, payroll &amp; policies — is{" "}
            <span className="font-medium text-ink">shared across all locations</span>.
          </p>
        </div>
      )}
    </div>
  );
}

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
    <div className="flex items-center gap-1">
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

      <LocationScopeInfo />
    </div>
  );
}
