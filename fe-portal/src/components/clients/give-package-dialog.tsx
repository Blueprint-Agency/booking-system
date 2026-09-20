"use client";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, DialogFooter, Label } from "@/components/ui";
import { fetchBindableInstructors, type CatalogInstructor } from "@/lib/catalog";
import { useWorkspace } from "@/lib/workspace-context";

/**
 * Give a member a **Complimentary Package** (#176) — a catalogue package at no
 * charge, with a reason.
 *
 * The picker offers the live catalogue and nothing else: a comp goes through
 * the same grant a purchase does, so anything the studio cannot sell it cannot
 * give either. The three extra choices appear only for the kinds that carry
 * them — a Home Location for an Unlimited Plan, the Cross-Location Add-On
 * beside it, a Bound Instructor for an Instructor-Bound PT package — because
 * the backend refuses each of them on anything else.
 *
 * The dialog states the two things that are true of the result and are not
 * visible from the form: nothing is emailed, and the package waits Dormant
 * until the member's first booking.
 */

interface CatalogClassPackage {
  id: string;
  name: string;
  kind: "credit_bundle" | "unlimited" | "trial";
  price_sgd: string;
  status: "active" | "archived";
}

interface CatalogPtPackage {
  id: string;
  name: string;
  price_sgd: string;
  status: "active" | "archived";
  instructor_bound: boolean;
}

export interface GivePackagePayload {
  package_kind: "class" | "pt";
  package_id: string;
  reason: string;
  location_id: string | null;
  cross_location: boolean;
  instructor_id: string | null;
}

/** One catalogue row, whichever table it came from. */
type Choice = {
  /** `class:<id>` or `pt:<id>` — the select's value, since ids collide across tables. */
  value: string;
  kind: "class" | "pt";
  id: string;
  name: string;
  priceSgd: string;
  unlimited: boolean;
  instructorBound: boolean;
};

export function GivePackageDialog({
  memberName,
  onGive,
  onClose,
}: {
  memberName: string;
  onGive: (payload: GivePackagePayload) => void;
  onClose: () => void;
}) {
  const { api, locations } = useWorkspace();
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [instructors, setInstructors] = useState<CatalogInstructor[]>([]);

  const [picked, setPicked] = useState("");
  const [reason, setReason] = useState("");
  const [locationId, setLocationId] = useState("");
  const [crossLocation, setCrossLocation] = useState(false);
  const [instructorId, setInstructorId] = useState("");

  useEffect(() => {
    if (!api) return;
    let live = true;
    Promise.all([
      api.get<{ class_packages: CatalogClassPackage[] }>(
        "/portal/admin/class-packages?status=active",
      ),
      api.get<{ pt_packages: CatalogPtPackage[] }>("/portal/admin/pt-packages?status=active"),
      fetchBindableInstructors(api),
    ])
      .then(([cls, pt, roster]) => {
        if (!live) return;
        setChoices([
          ...cls.class_packages.map((p) => ({
            value: `class:${p.id}`,
            kind: "class" as const,
            id: p.id,
            name: p.name,
            priceSgd: p.price_sgd,
            unlimited: p.kind === "unlimited",
            instructorBound: false,
          })),
          ...pt.pt_packages.map((p) => ({
            value: `pt:${p.id}`,
            kind: "pt" as const,
            id: p.id,
            name: p.name,
            priceSgd: p.price_sgd,
            unlimited: false,
            instructorBound: p.instructor_bound,
          })),
        ]);
        setInstructors(roster);
      })
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, [api]);

  const chosen = useMemo(
    () => (choices ?? []).find((c) => c.value === picked) ?? null,
    [choices, picked],
  );
  const studios = locations.filter((l) => !l.archivedAt);

  const ready =
    chosen !== null &&
    reason.trim() !== "" &&
    (!chosen.unlimited || locationId !== "") &&
    (!chosen.instructorBound || instructorId !== "");

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Give a package — ${memberName}`}
      description="A free package from the catalogue. It shows in Finance at S$0 against its list price, is not counted as revenue, and does not make the member a conversion. No email is sent — tell them yourself."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || !chosen) return;
          onGive({
            package_kind: chosen.kind,
            package_id: chosen.id,
            reason: reason.trim(),
            location_id: chosen.unlimited ? locationId : null,
            cross_location: chosen.unlimited && crossLocation,
            instructor_id: chosen.instructorBound ? instructorId : null,
          });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="give-package">Package</Label>
          <select
            id="give-package"
            required
            disabled={choices === null || loadError}
            value={picked}
            onChange={(e) => {
              setPicked(e.target.value);
              setLocationId("");
              setCrossLocation(false);
              setInstructorId("");
            }}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="">
              {loadError
                ? "Could not load the catalogue"
                : choices === null
                  ? "Loading…"
                  : "Select a package"}
            </option>
            {(choices ?? []).map((c) => (
              <option key={c.value} value={c.value}>
                {c.name} — list S${c.priceSgd}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">
            It waits Dormant and starts at the member&apos;s first booking, like a
            package they bought.
          </p>
        </div>

        {chosen?.unlimited && (
          <div className="space-y-1.5">
            <Label htmlFor="give-location">Home studio</Label>
            <select
              id="give-location"
              required
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="">Select a studio</option>
              {studios.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={crossLocation}
                onChange={(e) => setCrossLocation(e.target.checked)}
              />
              Include the Cross-Location Add-On, also free
            </label>
          </div>
        )}

        {chosen?.instructorBound && (
          <div className="space-y-1.5">
            <Label htmlFor="give-instructor">Bound instructor</Label>
            <select
              id="give-instructor"
              required
              value={instructorId}
              onChange={(e) => setInstructorId(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="">Select an instructor</option>
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted">
              This package&apos;s sessions go to one instructor.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="give-reason">Reason (required)</Label>
          <textarea
            id="give-reason"
            rows={3}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this is free — kept on the member's ledger and the audit log."
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready}>
            Give package
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
