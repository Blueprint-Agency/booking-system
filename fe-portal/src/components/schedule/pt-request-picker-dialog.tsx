"use client";
import { useState } from "react";
import { Button, Dialog, LoadFailure, Pagination, usePaged } from "@/components/ui";
import { rowsOf } from "@/lib/failed-read";
import { useRead } from "@/lib/use-read";
import { useWorkspace } from "@/lib/workspace-context";
import { ScheduleFromRequestDialog } from "@/components/pt-requests/schedule-from-request-dialog";
import { ManualPtSessionDialog } from "@/components/schedule/manual-pt-session-dialog";
import { type ApiPtRequest, ptClassTypeName, ptSlotTime } from "@/lib/pt-requests";
import type { Slot } from "@/lib/schedule";

export function PtRequestPickerDialog({
  slot,
  onClose,
  onScheduled,
}: {
  /** Slot picked off the timetable grid, seeding the scheduling form. */
  slot?: Slot;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const { activeLocation } = useWorkspace();
  const [picked, setPicked] = useState<ApiPtRequest | null>(null);
  /** Add manually: a session agreed outside the app, with no request behind it. */
  const [manual, setManual] = useState(false);

  // A failed read is "Couldn't load", never "No pending PT requests".
  const locationId = activeLocation?.id ?? null;
  const { read, retry } = useRead(
    locationId ?? "",
    async (api) => {
      const res = await api.get<{ pt_requests: ApiPtRequest[] }>("/portal/admin/pt-sessions", {
        status: "pending",
        location_id: locationId,
      });
      return res.pt_requests ?? [];
    },
    { enabled: locationId !== null, scope: "pt-request-picker" },
  );
  // With no workspace there is nothing to ask for, so nothing is pending.
  const pending = rowsOf(read);
  const loading = locationId !== null && read.status === "loading";
  const failed = read.status === "failed";

  const { visible, pagination } = usePaged(pending);

  if (manual) {
    return (
      <ManualPtSessionDialog
        role="admin"
        slot={slot}
        onClose={() => setManual(false)}
        onCreated={onScheduled}
      />
    );
  }

  if (picked) {
    return (
      <ScheduleFromRequestDialog
        request={picked}
        slot={slot}
        onClose={() => setPicked(null)}
        onScheduled={onScheduled}
      />
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add a PT session"
      description="Schedule a pending request, or add a session agreed outside the app."
    >
      {loading ? (
        <p className="px-1 py-4 text-sm text-muted">Loading…</p>
      ) : failed ? (
        <div className="space-y-3">
          <LoadFailure what="the pending PT requests" onRetry={retry} className="py-4" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => setManual(true)}>Add manually</Button>
          </div>
        </div>
      ) : pending.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            No pending PT requests. Customers submit requests from their app.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => setManual(true)}>Add manually</Button>
          </div>
        </div>
      ) : (
        <div>
          <ul className="divide-y divide-border">
            {visible.map((r) => {
              const first = r.slots[0];
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(r)}
                    className="block w-full px-3 py-2 text-left hover:bg-paper"
                  >
                    <div className="text-sm font-medium text-ink">{r.client.name}</div>
                    <div className="text-xs text-muted">
                      {r.session_type.toUpperCase()} · {ptClassTypeName(r.class_type)}
                      {first
                        ? ` · ${first.proposed_date} ${ptSlotTime(first)}`
                        : ""}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <Pagination {...pagination} noun="requests" className="px-3 sm:px-3" />
          <div className="mt-3 flex justify-end border-t border-border pt-3">
            <Button variant="secondary" onClick={() => setManual(true)}>
              Add manually
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
