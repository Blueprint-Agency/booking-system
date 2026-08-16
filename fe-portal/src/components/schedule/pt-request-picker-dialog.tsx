"use client";
import { useEffect, useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ScheduleFromRequestDialog } from "@/components/pt-requests/schedule-from-request-dialog";
import type { ApiPtRequest } from "@/lib/pt-requests";

export function PtRequestPickerDialog({
  onClose,
  onScheduled,
}: {
  onClose: () => void;
  onScheduled: () => void;
}) {
  const { api, activeLocation } = useWorkspace();
  const [pending, setPending] = useState<ApiPtRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<ApiPtRequest | null>(null);

  useEffect(() => {
    if (!api || !activeLocation) {
      setPending([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await api.get<{ pt_requests: ApiPtRequest[] }>(
          "/portal/admin/pt-sessions",
          { status: "pending", location_id: activeLocation.id },
        );
        if (!cancelled) setPending(res.pt_requests ?? []);
      } catch {
        if (!cancelled) setPending([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, activeLocation]);

  if (picked) {
    return (
      <ScheduleFromRequestDialog
        request={picked}
        onClose={() => setPicked(null)}
        onScheduled={onScheduled}
      />
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Schedule a pending PT request"
    >
      {loading ? (
        <p className="px-1 py-4 text-sm text-muted">Loading…</p>
      ) : pending.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            No pending PT requests. Customers submit requests from their app.
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
                    {r.session_type.toUpperCase()} · {r.class_type.name}
                    {first
                      ? ` · ${first.proposed_date} ${first.start_time}–${first.end_time}`
                      : ""}
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
