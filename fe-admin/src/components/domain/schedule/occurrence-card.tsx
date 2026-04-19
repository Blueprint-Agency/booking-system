"use client";

import Link from "next/link";
import { useState } from "react";
import { MoreHorizontal, UserCog, Ban, Users } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useWithTenant } from "@/lib/tenant-scope";
import { Badge, Button, Dialog, DialogFooter, Input, Select } from "@/components/ui";
import { overrideOccurrence } from "@/lib/schedule";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ScheduleOccurrence } from "@/lib/schedule";

export interface OccurrenceCardProps {
  occurrence: ScheduleOccurrence;
  compact?: boolean;
}

type OverrideKind = "substitute" | "cancel" | "capacity" | null;

export function OccurrenceCard({ occurrence }: OccurrenceCardProps) {
  const instructors = useWithTenant(useAdminState((s) => s.instructors));
  const instructor = instructors.find((i) => i.id === occurrence.instructorId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [override, setOverride] = useState<OverrideKind>(null);
  const [newInstructorId, setNewInstructorId] = useState(occurrence.instructorId);
  const [newCapacity, setNewCapacity] = useState(occurrence.capacity);
  const [note, setNote] = useState("");

  const cancelled = occurrence.status === "cancelled";

  const apply = (kind: OverrideKind) => {
    if (!note.trim()) {
      toast.error("Audit note required");
      return;
    }
    try {
      if (kind === "substitute") {
        overrideOccurrence({
          occurrenceId: occurrence.id,
          patch: { instructorId: newInstructorId },
          note,
          action: "session.update",
        });
        toast.success("Instructor substituted");
      } else if (kind === "cancel") {
        overrideOccurrence({
          occurrenceId: occurrence.id,
          patch: { status: "cancelled", cancelReason: note },
          note,
          action: "session.cancel",
        });
        toast.success("Occurrence cancelled");
      } else if (kind === "capacity") {
        overrideOccurrence({
          occurrenceId: occurrence.id,
          patch: { capacity: newCapacity },
          note,
          action: "session.update",
        });
        toast.success("Capacity updated");
      }
      setOverride(null);
      setNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <div
      className={cn(
        "group relative rounded-lg border bg-card p-3 text-left transition-shadow hover:shadow-sm",
        cancelled ? "border-error/40 opacity-60" : "border-border",
      )}
    >
      <Link
        href={`/admin/sessions/${occurrence.id}/roster`}
        className="block focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-mono text-muted">{occurrence.time}</div>
            <div className="truncate text-sm font-medium text-ink">{occurrence.name}</div>
            <div className="truncate text-xs text-muted">{instructor?.name ?? "—"}</div>
          </div>
          <Badge tone={cancelled ? "error" : occurrence.bookedCount >= occurrence.capacity ? "warning" : "neutral"}>
            {occurrence.bookedCount}/{occurrence.capacity}
          </Badge>
        </div>
      </Link>
      <button
        type="button"
        aria-label="Override actions"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        className="absolute right-2 top-2 rounded p-1 text-muted opacity-0 transition-opacity hover:bg-paper group-hover:opacity-100"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {menuOpen && (
        <div
          className="absolute right-2 top-8 z-20 w-44 rounded-md border border-border bg-card shadow-md"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            type="button"
            onClick={() => {
              setOverride("substitute");
              setMenuOpen(false);
              setNewInstructorId(occurrence.instructorId);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-ink hover:bg-paper"
          >
            <UserCog className="h-3.5 w-3.5" /> Substitute instructor
          </button>
          <button
            type="button"
            onClick={() => {
              setOverride("capacity");
              setMenuOpen(false);
              setNewCapacity(occurrence.capacity);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-ink hover:bg-paper"
          >
            <Users className="h-3.5 w-3.5" /> Change capacity
          </button>
          <button
            type="button"
            onClick={() => {
              setOverride("cancel");
              setMenuOpen(false);
            }}
            disabled={cancelled}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-error hover:bg-paper disabled:opacity-50"
          >
            <Ban className="h-3.5 w-3.5" /> Cancel this date
          </button>
        </div>
      )}

      <Dialog
        open={override === "substitute"}
        onOpenChange={(o) => !o && setOverride(null)}
        title="Substitute instructor"
        description={`${occurrence.name} · ${occurrence.date} ${occurrence.time}`}
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
          <Button type="button" variant="ghost" onClick={() => setOverride(null)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => apply("substitute")}>
            Substitute
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={override === "capacity"}
        onOpenChange={(o) => !o && setOverride(null)}
        title="Change capacity"
        description={`${occurrence.name} · ${occurrence.date} ${occurrence.time}`}
      >
        <div className="space-y-3">
          <Input
            type="number"
            min={1}
            value={newCapacity}
            onChange={(e) => setNewCapacity(Number(e.target.value))}
          />
          <Input
            placeholder="Audit note (required)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOverride(null)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => apply("capacity")}>
            Save
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={override === "cancel"}
        onOpenChange={(o) => !o && setOverride(null)}
        title="Cancel this occurrence"
        description={`${occurrence.name} · ${occurrence.date} ${occurrence.time}. Existing bookings stay until manually refunded.`}
      >
        <div className="space-y-3">
          <Input
            placeholder="Reason (required, audit note)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOverride(null)}>
            Back
          </Button>
          <Button type="button" variant="danger" onClick={() => apply("cancel")}>
            Cancel occurrence
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
