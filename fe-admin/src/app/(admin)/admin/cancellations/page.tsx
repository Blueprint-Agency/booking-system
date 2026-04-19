"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, Button } from "@/components/ui";
import { InboxShell } from "@/components/inbox/inbox-shell";
import { InboxRow } from "@/components/inbox/inbox-row";
import { InboxDrawer } from "@/components/inbox/inbox-drawer";
import { ReasonRequiredDialog } from "@/components/dialogs/reason-required-dialog";
import { markCancellationResolved } from "@/lib/mutations/cancellations";
import { formatRelative } from "@/lib/formatters";
import type { CancellationRequest } from "@/types";

export default function CancellationsInboxPage() {
  const requests = useAdminState((s) => s.cancellationRequests);
  const clients = useAdminState((s) => s.clients);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);

  const open = requests.filter((r) => r.status === "open");
  const resolved = requests.filter((r) => r.status === "resolved");
  const active = activeId ? requests.find((r) => r.id === activeId) ?? null : null;
  const activeClient = active ? clientById.get(active.clientId) : null;

  const renderList = (rows: CancellationRequest[]) => {
    if (rows.length === 0) {
      return (
        <div className="rounded-md border border-dashed border-border bg-paper/40 px-4 py-8 text-center text-xs text-muted">
          No requests in this state.
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-border bg-card">
        {rows.map((r) => {
          const c = clientById.get(r.clientId);
          return (
            <InboxRow
              key={r.id}
              active={r.id === activeId}
              onClick={() => setActiveId(r.id)}
              primary={c?.name ?? "Unknown"}
              secondary={r.reason}
              meta={formatRelative(r.openedAt)}
            />
          );
        })}
      </div>
    );
  };

  const onResolve = async (reason: string) => {
    if (!active) return;
    try {
      markCancellationResolved(active.id, reason);
      toast.success("Marked resolved");
      setActiveId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <>
      <PageHeader
        title="Cancellations"
        description="Cancellation requests for bookings or memberships. Settled out-of-app, audited here."
      />
      <div className="mt-6">
        <InboxShell
          tabs={[
            { key: "open", label: "Open", count: open.length },
            { key: "resolved", label: "Resolved", count: resolved.length },
          ]}
        >
          {(tab) => (tab === "open" ? renderList(open) : renderList(resolved))}
        </InboxShell>
      </div>

      <InboxDrawer
        open={!!active}
        onClose={() => setActiveId(null)}
        title="Cancellation request"
        subtitle={activeClient ? `${activeClient.name} · ${activeClient.phone}` : ""}
        actions={
          active?.status === "open" && (
            <Button type="button" onClick={() => setReasonOpen(true)}>
              Mark resolved
            </Button>
          )
        }
      >
        {active && activeClient && (
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted">Reason</div>
              <p className="mt-0.5 text-ink">{active.reason}</p>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted">Channel</div>
              <p className="mt-0.5 text-ink">{active.channel}</p>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted">Opened</div>
              <p className="mt-0.5 text-ink">{formatRelative(active.openedAt)}</p>
            </div>
            {active.resolutionNote && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted">Resolution note</div>
                <p className="mt-0.5 text-ink">{active.resolutionNote}</p>
              </div>
            )}
            <div className="pt-2">
              <a
                href={`https://wa.me/${activeClient.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                  `Hi ${activeClient.name}, regarding your cancellation request — `,
                )}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-paper px-3 py-1.5 text-xs font-medium text-ink hover:bg-card"
              >
                Open WhatsApp <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}
      </InboxDrawer>

      <ReasonRequiredDialog
        open={reasonOpen}
        onOpenChange={setReasonOpen}
        title="Mark cancellation resolved"
        description="Note what was done (booking cancelled + credit returned, membership paused, etc)."
        confirmLabel="Mark resolved"
        onConfirm={onResolve}
      />
    </>
  );
}
