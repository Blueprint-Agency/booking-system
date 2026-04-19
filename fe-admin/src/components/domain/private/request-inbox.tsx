"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, X, Clock } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useWithTenant } from "@/lib/tenant-scope";
import {
  Badge,
  Button,
  Dialog,
  DialogFooter,
  EmptyState,
  Input,
  StatusBadge,
} from "@/components/ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { SlaChip } from "./sla-chip";
import {
  acceptPrivateRequest,
  declinePrivateRequest,
  proposeAlternative,
} from "@/lib/mutations/private";
import { formatDateTime } from "@/lib/formatters";
import type { PrivateRequest } from "@/types";

type Action = "accept" | "decline" | "propose" | null;

export function RequestInbox() {
  const reqs = useWithTenant(useAdminState((s) => s.privateRequests));
  const clients = useAdminState((s) => s.clients);
  const instructors = useAdminState((s) => s.instructors);
  const products = useAdminState((s) => s.products);

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const instructorById = useMemo(
    () => new Map(instructors.map((i) => [i.id, i])),
    [instructors],
  );
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const [target, setTarget] = useState<PrivateRequest | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [note, setNote] = useState("");
  const [proposed, setProposed] = useState("");

  const open = (r: PrivateRequest, a: Exclude<Action, null>) => {
    setTarget(r);
    setAction(a);
    setNote("");
    setProposed("");
  };
  const close = () => {
    setTarget(null);
    setAction(null);
  };

  const submit = () => {
    if (!target) return;
    try {
      if (action === "accept") acceptPrivateRequest(target.id, note);
      else if (action === "decline") declinePrivateRequest(target.id, note);
      else if (action === "propose") proposeAlternative(target.id, proposed, note);
      toast.success("Updated");
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const columns: DataTableColumn<PrivateRequest>[] = [
    {
      key: "client",
      header: "Client",
      sortable: true,
      sortValue: (r) => clientById.get(r.clientId)?.name ?? "",
      cell: (r) => (
        <span className="text-sm font-medium text-ink">
          {clientById.get(r.clientId)?.name ?? "—"}
        </span>
      ),
    },
    {
      key: "instructor",
      header: "Instructor",
      cell: (r) => (
        <span className="text-sm text-muted">
          {instructorById.get(r.instructorId)?.name ?? "—"}
        </span>
      ),
    },
    {
      key: "product",
      header: "Product",
      cell: (r) => (
        <Badge tone="neutral">
          {productById.get(r.productId)?.name ?? r.productId}
        </Badge>
      ),
    },
    {
      key: "slot",
      header: "Requested",
      cell: (r) => (
        <span className="text-sm text-ink">{formatDateTime(r.requestedSlotIso)}</span>
      ),
    },
    {
      key: "sla",
      header: "SLA",
      cell: (r) => (r.status === "pending" ? <SlaChip dueAt={r.slaDueAt} /> : null),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => {
        if (r.status !== "pending") return null;
        return (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => open(r, "accept")}
              title="Accept"
              className="rounded p-1.5 text-muted hover:bg-paper hover:text-sage"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => open(r, "propose")}
              title="Propose alternative"
              className="rounded p-1.5 text-muted hover:bg-paper hover:text-warning"
            >
              <Clock className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => open(r, "decline")}
              title="Decline"
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
      <DataTable<PrivateRequest>
        rows={reqs}
        columns={columns}
        rowKey={(r) => r.id}
        empty={
          <EmptyState
            title="No private requests"
            description="Pending requests appear here, sorted by SLA."
          />
        }
      />
      <Dialog
        open={action === "accept"}
        onOpenChange={(o) => !o && close()}
        title="Accept request"
        description="Accepting confirms the requested slot for the client."
      >
        <Input placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit}>Accept</Button>
        </DialogFooter>
      </Dialog>
      <Dialog
        open={action === "decline"}
        onOpenChange={(o) => !o && close()}
        title="Decline request"
        description="A reason is required and will be shared with the client."
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
            Decline
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog
        open={action === "propose"}
        onOpenChange={(o) => !o && close()}
        title="Propose alternative slot"
        description="Sends a counter-offer to the client; status becomes 'alt proposed'."
      >
        <div className="space-y-3">
          <Input
            type="datetime-local"
            value={proposed}
            onChange={(e) => setProposed(e.target.value)}
          />
          <Input
            placeholder="Optional note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit}>Propose</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
