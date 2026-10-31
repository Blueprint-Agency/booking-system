"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Dialog, LoadFailure, Pagination, usePaged } from "@/components/ui";
import { rowsOf } from "@/lib/failed-read";
import { useRead } from "@/lib/use-read";
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
  client: { id: string; name: string; email: string; photo_url: string | null };
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
  const [picked, setPicked] = useState<CorporateRequest | null>(null);

  // A failed read is "Couldn't load", never "No pending corporate requests".
  const { read, retry } = useRead(
    "pending",
    async (api) => {
      const res = await api.get<{
        corporate_requests: ApiCorporateRequest[];
      }>("/portal/admin/corporate-requests", { status: "pending" });
      return res.corporate_requests.map(fromApi);
    },
    { scope: "corporate-request-picker" },
  );
  const pending = rowsOf(read);
  const loading = read.status === "loading";
  const failed = read.status === "failed";

  const { visible, pagination } = usePaged(pending);

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
      ) : failed ? (
        <div className="space-y-3">
          <LoadFailure what="the pending corporate requests" onRetry={retry} className="py-4" />
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
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
        <div>
          <ul className="divide-y divide-border">
            {visible.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setPicked(r)}
                  className="block min-h-11 w-full px-3 py-2 text-left hover:bg-paper"
                >
                  <div className="break-words text-sm font-medium text-ink">
                    {r.client.name}
                  </div>
                  <div className="text-xs text-muted">{r.package.name}</div>
                </button>
              </li>
            ))}
          </ul>
          <Pagination {...pagination} noun="requests" className="px-3 sm:px-3" />
        </div>
      )}
    </Dialog>
  );
}
