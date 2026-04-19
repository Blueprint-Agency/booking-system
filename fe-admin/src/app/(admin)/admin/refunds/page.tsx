"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, Button, Badge } from "@/components/ui";
import { InboxShell } from "@/components/inbox/inbox-shell";
import { InboxRow } from "@/components/inbox/inbox-row";
import { InboxDrawer } from "@/components/inbox/inbox-drawer";
import { ReasonRequiredDialog } from "@/components/dialogs/reason-required-dialog";
import { markRefundResolved, markRefundDeclined } from "@/lib/mutations/refunds";
import { formatCurrency, formatRelative } from "@/lib/formatters";
import type { RefundRequest } from "@/types";

type ReasonAction = "resolve" | "decline" | null;

export default function RefundsInboxPage() {
  const requests = useAdminState((s) => s.refundRequests);
  const clients = useAdminState((s) => s.clients);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [reasonAction, setReasonAction] = useState<ReasonAction>(null);

  const open = requests.filter((r) => r.status === "open");
  const resolved = requests.filter((r) => r.status === "resolved");
  const declined = requests.filter((r) => r.status === "declined");

  const active = activeId ? requests.find((r) => r.id === activeId) ?? null : null;
  const activeClient = active ? clientById.get(active.clientId) : null;

  const renderList = (rows: RefundRequest[]) => {
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
              primary={
                <>
                  <span>{c?.name ?? "Unknown"}</span>
                  <Badge tone="neutral">{formatCurrency(r.amountCents)}</Badge>
                </>
              }
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
      markRefundResolved(active.id, reason);
      toast.success("Marked resolved");
      setActiveId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const onDecline = async (reason: string) => {
    if (!active) return;
    try {
      markRefundDeclined(active.id, reason);
      toast.success("Marked declined");
      setActiveId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <>
      <PageHeader
        title="Refunds"
        description="Refund requests are settled out-of-app via WhatsApp / PayNow. This inbox is the audit trail."
      />
      <div className="mt-6">
        <InboxShell
          tabs={[
            { key: "open", label: "Open", count: open.length },
            { key: "resolved", label: "Resolved", count: resolved.length },
            { key: "declined", label: "Declined", count: declined.length },
          ]}
        >
          {(tab) =>
            tab === "open" ? renderList(open) : tab === "resolved" ? renderList(resolved) : renderList(declined)
          }
        </InboxShell>
      </div>

      <InboxDrawer
        open={!!active}
        onClose={() => setActiveId(null)}
        title={active ? `Refund · ${formatCurrency(active.amountCents)}` : ""}
        subtitle={activeClient ? `${activeClient.name} · ${activeClient.phone}` : ""}
        actions={
          active?.status === "open" && (
            <>
              <Button variant="ghost" type="button" onClick={() => setReasonAction("decline")}>
                Decline
              </Button>
              <Button type="button" onClick={() => setReasonAction("resolve")}>
                Mark resolved
              </Button>
            </>
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
                  `Hi ${activeClient.name}, regarding your refund request — `,
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
        open={reasonAction === "resolve"}
        onOpenChange={(o) => !o && setReasonAction(null)}
        title="Mark refund resolved"
        description="Note the resolution (PayNow ref, credit issued, etc). This becomes the audit trail."
        confirmLabel="Mark resolved"
        onConfirm={onResolve}
      />
      <ReasonRequiredDialog
        open={reasonAction === "decline"}
        onOpenChange={(o) => !o && setReasonAction(null)}
        title="Decline refund"
        description="Reason for declining (per policy, no-show, etc)."
        confirmLabel="Decline"
        confirmVariant="danger"
        onConfirm={onDecline}
      />
    </>
  );
}
