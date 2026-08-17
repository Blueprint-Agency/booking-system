"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Dialog } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ScheduleFromCorporateRequestDialog } from "@/components/corporate-requests/schedule-from-corporate-request-dialog";
import type { CorporateRequest, CorporateRequestStatus } from "@/types";
import type { Slot } from "@/lib/schedule";

interface ApiCorporateRequest {
  id: string;
  status: CorporateRequestStatus;
  preferred_location: string | null;
  message: string | null;
  created_at: string;
  resolved_at: string | null;
  client: { id: string; name: string; email: string };
  package: { id: string; name: string };
  session: null;
}

function fromApi(r: ApiCorporateRequest): CorporateRequest {
  return {
    id: r.id,
    status: r.status,
    preferredLocation: r.preferred_location,
    message: r.message,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    client: r.client,
    package: r.package,
    session: null,
  };
}

export function CorporateRequestPickerDialog({
  slot,
  onClose,
  onScheduled,
}: {
  /** Slot picked off the timetable grid, seeding the scheduling form. */
  slot?: Slot;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const { api } = useWorkspace();
  const [pending, setPending] = useState<CorporateRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<CorporateRequest | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{
          corporate_requests: ApiCorporateRequest[];
        }>("/portal/admin/corporate-requests", { status: "pending" });
        if (cancelled) return;
        setPending(res.corporate_requests.map(fromApi));
      } catch {
        if (cancelled) return;
        setPending([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (picked) {
    return (
      <ScheduleFromCorporateRequestDialog
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
      title="Schedule a pending corporate request"
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : pending.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            No pending corporate requests. They appear here automatically when a
            member buys a corporate package.
          </p>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {pending.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setPicked(r)}
                className="block w-full px-3 py-2 text-left hover:bg-paper"
              >
                <div className="text-sm font-medium text-ink">
                  {r.client.name}
                </div>
                <div className="text-xs text-muted">{r.package.name}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
