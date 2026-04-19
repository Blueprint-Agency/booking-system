"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useWithTenant } from "@/lib/tenant-scope";
import { Button, Dialog, DialogFooter, EmptyState, Input, StatusBadge } from "@/components/ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { approveReferral, denyReferral } from "@/lib/mutations/referrals";
import { formatRelative } from "@/lib/formatters";
import type { ReferralEvent } from "@/types";

type Action = "approve" | "deny" | null;

export function ReferralReviewQueue() {
  const events = useWithTenant(useAdminState((s) => s.referralEvents));
  const clients = useAdminState((s) => s.clients);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const [target, setTarget] = useState<ReferralEvent | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [note, setNote] = useState("");

  const open = (ev: ReferralEvent, a: Exclude<Action, null>) => {
    setTarget(ev);
    setAction(a);
    setNote("");
  };
  const close = () => {
    setTarget(null);
    setAction(null);
  };

  const submit = () => {
    if (!target) return;
    try {
      if (action === "approve") approveReferral(target.id, note);
      if (action === "deny") denyReferral(target.id, note);
      toast.success("Updated");
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const columns: DataTableColumn<ReferralEvent>[] = [
    {
      key: "code",
      header: "Code",
      cell: (e) => <span className="font-mono text-sm font-semibold text-ink">{e.code}</span>,
    },
    {
      key: "referrer",
      header: "Referrer",
      cell: (e) => (
        <span className="text-sm text-ink">
          {clientById.get(e.referrerClientId) ?? e.referrerClientId}
        </span>
      ),
    },
    {
      key: "referee",
      header: "New client",
      cell: (e) => (
        <span className="text-sm text-ink">
          {clientById.get(e.refereeClientId) ?? e.refereeClientId}
        </span>
      ),
    },
    {
      key: "created",
      header: "Created",
      cell: (e) => <span className="text-xs text-muted">{formatRelative(e.createdAt)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (e) => <StatusBadge status={e.status} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (e) => {
        if (e.status === "credited" || e.status === "denied") return null;
        return (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => open(e, "approve")}
              title="Approve"
              className="rounded p-1.5 text-muted hover:bg-paper hover:text-sage"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => open(e, "deny")}
              title="Deny"
              className="rounded p-1.5 text-muted hover:bg-paper hover:text-error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <DataTable<ReferralEvent>
        rows={events}
        columns={columns}
        rowKey={(e) => e.id}
        empty={
          <EmptyState
            title="No referrals to review"
            description="Pending and recently joined referrals will appear here."
          />
        }
      />
      <Dialog
        open={action === "approve"}
        onOpenChange={(o) => !o && close()}
        title="Approve referral"
        description="Credits the referrer once approved. Audit-logged."
      >
        <Input placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit}>Approve</Button>
        </DialogFooter>
      </Dialog>
      <Dialog
        open={action === "deny"}
        onOpenChange={(o) => !o && close()}
        title="Deny referral"
        description="Reason is required."
      >
        <Input
          placeholder="Reason (required)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Back
          </Button>
          <Button variant="danger" onClick={submit}>
            Deny
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
