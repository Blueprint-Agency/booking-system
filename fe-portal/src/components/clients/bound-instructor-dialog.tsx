"use client";
import { useEffect, useState } from "react";
import { Button, Dialog, DialogFooter, Label } from "@/components/ui";
import { fetchBindableInstructors, type CatalogInstructor } from "@/lib/catalog";
import { useWorkspace } from "@/lib/workspace-context";

// "" is "nothing picked yet" and NONE is the deliberate choice to reopen the
// package to anyone — two different states, so null cannot stand in for both.
const NONE = "none";

/**
 * Bind a purchased PT Package to an instructor, move it to a different one, or
 * clear it back to open (spec §33-§37). The admin-side counterpart to the pick
 * a member makes at checkout, for a package sold open, a member changing coach,
 * or a coach who has left.
 *
 * The dialog names the one consequence that is not visible from the row: this
 * decides who may pick up FUTURE requests, and sessions already on the calendar
 * stay exactly where they are.
 *
 * The picker offers only accepted, unarchived instructors, because that is the
 * roster the backend checks the pick against. The instructor the package is
 * bound to today is deliberately absent from the choices — rebinding to them is
 * refused as a no-op, so offering it would offer a dead end — but they are
 * named in the note, including when they have since been archived.
 */
export function BoundInstructorDialog({
  packageName,
  currentInstructor,
  onSave,
  onClose,
}: {
  packageName: string;
  /** Who the package is bound to today; null means open to anyone. */
  currentInstructor: { id: string; name: string } | null;
  onSave: (instructorId: string | null, reason: string) => void;
  onClose: () => void;
}) {
  const { api } = useWorkspace();
  const [instructors, setInstructors] = useState<CatalogInstructor[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [choice, setChoice] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!api) return;
    let live = true;
    fetchBindableInstructors(api)
      .then((rows) => live && setInstructors(rows))
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, [api]);

  const choices = (instructors ?? []).filter((i) => i.id !== currentInstructor?.id);
  const ready = choice !== "" && reason.trim() !== "";

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Bound instructor — ${packageName}`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          onSave(choice === NONE ? null : choice, reason.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="bound-instructor">Bind to</Label>
          <select
            id="bound-instructor"
            required
            disabled={instructors === null || loadError}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm disabled:opacity-60"
          >
            <option value="">
              {loadError
                ? "Could not load instructors"
                : instructors === null
                  ? "Loading instructors…"
                  : "Select an instructor"}
            </option>
            {currentInstructor && (
              <option value={NONE}>No instructor — open to anyone</option>
            )}
            {choices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">
            {currentInstructor
              ? `Currently with ${currentInstructor.name}.`
              : "Currently open to any instructor."}{" "}
            This changes who may pick up future requests only — sessions already
            scheduled stay with the instructor teaching them.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bound-instructor-reason">Reason (required)</Label>
          <textarea
            id="bound-instructor-reason"
            rows={3}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
