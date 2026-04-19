"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { UserCog, Ban, Copy, X } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useCurrentTenantId } from "@/lib/admin-auth";
import { useWithTenant } from "@/lib/tenant-scope";
import { Button, Dialog, DialogFooter, Input, Select, Badge } from "@/components/ui";
import { expandSchedule, overrideOccurrence, ensureMaterialized } from "@/lib/schedule";
import { cancelBookingAdmin } from "@/lib/mutations/bookings";

export interface ScheduleBulkBarProps {
  selectedDates: string[];
  weekStart: string;
  onClear: () => void;
}

type Action = "instructor" | "cancel" | "copy" | null;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function ScheduleBulkBar({ selectedDates, weekStart, onClear }: ScheduleBulkBarProps) {
  const tenantId = useCurrentTenantId();
  const state = useAdminState((s) => s);
  const instructors = useWithTenant(useAdminState((s) => s.instructors));
  const [action, setAction] = useState<Action>(null);
  const [newInstructorId, setNewInstructorId] = useState(instructors[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [refund, setRefund] = useState(true);

  const occurrences = useMemo(() => {
    const all = expandSchedule(state, { tenantId, fromIso: weekStart, days: 14 });
    return all.filter((o) => selectedDates.includes(o.date));
  }, [state, tenantId, weekStart, selectedDates]);

  const reset = () => {
    setAction(null);
    setNote("");
  };

  const requireNote = (): string | null => {
    const trimmed = note.trim();
    if (!trimmed) {
      toast.error("Audit note required");
      return null;
    }
    return trimmed;
  };

  const shiftInstructor = () => {
    const n = requireNote();
    if (!n) return;
    if (!newInstructorId) {
      toast.error("Pick an instructor");
      return;
    }
    let count = 0;
    for (const occ of occurrences) {
      try {
        overrideOccurrence({
          occurrenceId: occ.id,
          patch: { instructorId: newInstructorId },
          note: n,
          action: "session.update",
        });
        count++;
      } catch {
        // continue
      }
    }
    toast.success(`Shifted instructor on ${count} occurrence${count === 1 ? "" : "s"}`);
    reset();
    onClear();
  };

  const cancelSelected = () => {
    const n = requireNote();
    if (!n) return;
    let cancelled = 0;
    let refunded = 0;
    for (const occ of occurrences) {
      try {
        overrideOccurrence({
          occurrenceId: occ.id,
          patch: { status: "cancelled", cancelReason: n },
          note: n,
          action: "session.cancel",
        });
        cancelled++;
        // refund associated bookings
        const bookings = state.bookings.filter(
          (b) => b.sessionId === occ.id && b.status !== "cancelled",
        );
        for (const b of bookings) {
          try {
            cancelBookingAdmin({ bookingId: b.id, refund, reason: n });
            refunded++;
          } catch {
            // continue
          }
        }
      } catch {
        // continue
      }
    }
    toast.success(
      `Cancelled ${cancelled} occurrence${cancelled === 1 ? "" : "s"}, ${refunded} booking${refunded === 1 ? "" : "s"} ${refund ? "refunded" : "forfeited"}`,
    );
    reset();
    onClear();
  };

  const copyLastWeek = () => {
    const n = requireNote();
    if (!n) return;
    let copied = 0;
    for (const occ of occurrences) {
      const sourceDate = addDays(occ.date, -7);
      const sourceId = occ.templateId
        ? `${occ.templateId}@${sourceDate}`
        : occ.id;
      const sourceSession = state.sessions.find((s) => s.id === sourceId);
      if (!sourceSession) continue;
      try {
        ensureMaterialized(occ.id);
        overrideOccurrence({
          occurrenceId: occ.id,
          patch: {
            instructorId: sourceSession.instructorId,
            capacity: sourceSession.capacity,
            status: sourceSession.status === "cancelled" ? "scheduled" : sourceSession.status,
          },
          note: n,
          action: "session.update",
        });
        copied++;
      } catch {
        // continue
      }
    }
    toast.success(
      copied > 0
        ? `Copied overrides from last week onto ${copied} occurrence${copied === 1 ? "" : "s"}`
        : "Last week had no overrides to copy — templates already recur as-is",
    );
    reset();
    onClear();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
      <Badge tone="accent">{selectedDates.length} day{selectedDates.length === 1 ? "" : "s"} selected</Badge>
      <span className="text-xs text-muted">{occurrences.length} occurrence{occurrences.length === 1 ? "" : "s"}</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" onClick={() => setAction("instructor")} disabled={occurrences.length === 0}>
          <UserCog className="mr-1 h-4 w-4" /> Shift instructor
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAction("cancel")} disabled={occurrences.length === 0}>
          <Ban className="mr-1 h-4 w-4" /> Cancel day(s)
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAction("copy")} disabled={occurrences.length === 0}>
          <Copy className="mr-1 h-4 w-4" /> Copy last week
        </Button>
        <button
          type="button"
          onClick={onClear}
          className="rounded p-1.5 text-muted hover:bg-paper hover:text-ink"
          aria-label="Clear selection"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Dialog
        open={action === "instructor"}
        onOpenChange={(o) => !o && reset()}
        title="Shift instructor for selected days"
        description={`${occurrences.length} occurrences will be reassigned. Audit-logged.`}
      >
        <div className="space-y-3">
          <Select value={newInstructorId} onChange={(e) => setNewInstructorId(e.target.value)}>
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
          <Input
            placeholder="Audit note (required)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={reset}>
            Cancel
          </Button>
          <Button type="button" onClick={shiftInstructor}>
            Shift {occurrences.length}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={action === "cancel"}
        onOpenChange={(o) => !o && reset()}
        title="Cancel selected days"
        description={`Cancels ${occurrences.length} occurrences and any associated bookings. Refund follows the toggle below.`}
      >
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={refund}
              onChange={(e) => setRefund(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <span className="text-ink">Refund credits to package holders</span>
          </label>
          <Input
            placeholder="Reason (required, audit note)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={reset}>
            Back
          </Button>
          <Button type="button" variant="danger" onClick={cancelSelected}>
            Cancel {occurrences.length}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={action === "copy"}
        onOpenChange={(o) => !o && reset()}
        title="Copy last week's schedule"
        description="Applies any overrides (instructor / capacity) from the same weekday 7 days ago to the selected days."
      >
        <div className="space-y-3">
          <Input
            placeholder="Audit note (required)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={reset}>
            Cancel
          </Button>
          <Button type="button" onClick={copyLastWeek}>
            Copy
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
