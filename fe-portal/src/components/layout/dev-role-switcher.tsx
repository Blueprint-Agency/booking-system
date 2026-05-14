"use client";
import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";

export function DevRoleSwitcher() {
  const { currentStaff, allStaff, switchStaff, locations, updateStaffGrants } =
    useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const initial = currentStaff.name.charAt(0);
  // Demo affordance only shows admin-app staff (superadmin + admin); instructors
  // log into their own surfaces in production.
  const switchableStaff = allStaff.filter(
    (s) => s.role === "superadmin" || s.role === "admin"
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-border bg-paper px-2 py-1 text-xs sm:px-3 sm:py-1.5"
      >
        <div className="h-6 w-6 rounded-full bg-accent text-center text-[11px] font-semibold leading-6 text-white">
          {initial}
        </div>
        <div className="hidden leading-tight sm:block">
          <div className="font-medium text-ink">{currentStaff.name}</div>
          <div className="text-muted capitalize">{currentStaff.role}</div>
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-72 rounded-lg border border-border bg-card shadow-modal">
          <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Demo — switch staff
          </div>
          <ul className="p-1">
            {switchableStaff.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => switchStaff(s.id)}
                  className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-paper ${
                    s.id === currentStaff.id ? "bg-paper" : ""
                  }`}
                >
                  <div className="flex-1">
                    <div className="font-medium text-ink">{s.name}</div>
                    <div className="text-xs text-muted capitalize">
                      {s.role}
                      {s.role === "admin" && s.grantedLocationIds.length > 0 && (
                        <>
                          {" · "}
                          {s.grantedLocationIds
                            .map(
                              (id) =>
                                locations.find((l) => l.id === id)?.name ?? "?"
                            )
                            .join(", ")}
                        </>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {currentStaff.role === "admin" && (
            <>
              <div className="border-t border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                My grants
              </div>
              <div className="space-y-1 p-2">
                {locations
                  .filter((l) => !l.archivedAt)
                  .map((l) => {
                    const granted = currentStaff.grantedLocationIds.includes(l.id);
                    return (
                      <label
                        key={l.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-paper"
                      >
                        <input
                          type="checkbox"
                          checked={granted}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...currentStaff.grantedLocationIds, l.id]
                              : currentStaff.grantedLocationIds.filter(
                                  (x) => x !== l.id
                                );
                            updateStaffGrants(next);
                          }}
                        />
                        <span>{l.name}</span>
                      </label>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
