"use client";
import { useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { clients, instructors, ptRequests as seedRequests } from "@/data";
import {
  ScheduleFromRequestDialog,
  type SchedulePayload,
} from "@/components/pt-requests/schedule-from-request-dialog";
import type { PtRequest } from "@/types";

export function PtRequestPickerDialog({
  onClose,
  onScheduled,
}: {
  onClose: () => void;
  onScheduled: (req: PtRequest, payload: SchedulePayload) => void;
}) {
  const pending = seedRequests
    .filter((r) => r.status === "pending")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [picked, setPicked] = useState<PtRequest | null>(null);

  if (picked) {
    return (
      <ScheduleFromRequestDialog
        request={picked}
        onClose={() => setPicked(null)}
        onConfirm={(payload) => onScheduled(picked, payload)}
      />
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Schedule a pending PT request"
    >
      {pending.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            No pending PT requests. Clients submit requests from their app.
          </p>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {pending.map((r) => {
            const client = clients.find((c) => c.id === r.clientId);
            const instructor = r.preferredInstructorId
              ? instructors.find((i) => i.id === r.preferredInstructorId)
              : null;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setPicked(r)}
                  className="block w-full px-3 py-2 text-left hover:bg-paper"
                >
                  <div className="text-sm font-medium text-ink">
                    {client?.name ?? "—"}
                  </div>
                  <div className="text-xs text-muted">
                    {r.sessionType.toUpperCase()} · {r.durationMinutes} min ·{" "}
                    {instructor?.name ?? "Any"} · {r.preferredSlots[0].date}{" "}
                    {r.preferredSlots[0].startTime}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
