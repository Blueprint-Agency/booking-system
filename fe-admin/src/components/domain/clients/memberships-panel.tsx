"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { useWithTenant } from "@/lib/tenant-scope";
import {
  Badge,
  Button,
  Dialog,
  DialogFooter,
  EmptyState,
  Input,
  Select,
} from "@/components/ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { formatDate } from "@/lib/formatters";
import {
  pauseMembership,
  cancelMembership,
  changeMembershipPlan,
} from "@/lib/mutations/memberships";
import type { Membership } from "@/types";

type Action = "pause" | "cancel" | "change" | null;

export interface MembershipsPanelProps {
  clientId: string;
}

export function MembershipsPanel({ clientId }: MembershipsPanelProps) {
  const memberships = useAdminState((s) =>
    s.memberships.filter((m) => m.clientId === clientId),
  );
  const products = useWithTenant(useAdminState((s) => s.products));
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const membershipProducts = useMemo(
    () => products.filter((p) => p.type === "membership"),
    [products],
  );
  const [target, setTarget] = useState<Membership | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [resumeAt, setResumeAt] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [newProductId, setNewProductId] = useState("");
  const [note, setNote] = useState("");

  const open = (m: Membership, a: Exclude<Action, null>) => {
    setTarget(m);
    setAction(a);
    setNote("");
    setResumeAt("");
    setEffectiveAt(new Date().toISOString().slice(0, 10));
    setNewProductId(m.productId);
  };
  const close = () => {
    setTarget(null);
    setAction(null);
  };

  const submit = () => {
    if (!target) return;
    try {
      if (action === "pause") {
        if (!resumeAt) {
          toast.error("Pick a resume date");
          return;
        }
        pauseMembership({ membershipId: target.id, resumeAt, note });
        toast.success("Paused");
      } else if (action === "cancel") {
        cancelMembership({ membershipId: target.id, effectiveAt, reason: note });
        toast.success("Cancelled");
      } else if (action === "change") {
        changeMembershipPlan({ membershipId: target.id, newProductId, note });
        toast.success("Plan changed");
      }
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const columns: DataTableColumn<Membership>[] = [
    {
      key: "product",
      header: "Plan",
      cell: (m) => (
        <span className="font-medium text-ink">
          {productById.get(m.productId)?.name ?? m.productId}
        </span>
      ),
    },
    {
      key: "started",
      header: "Started",
      cell: (m) => <span className="text-sm text-muted">{formatDate(m.startedAt)}</span>,
    },
    {
      key: "next",
      header: "Next bill",
      cell: (m) => (
        <span className="text-sm text-muted">
          {m.nextBillingDate ? formatDate(m.nextBillingDate) : "—"}
        </span>
      ),
    },
    {
      key: "usage",
      header: "Usage",
      align: "right",
      cell: (m) => (
        <span className="text-sm tabular-nums">
          {m.sessionsUsedThisMonth} / {m.sessionsPerMonth ?? "∞"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (m) => (
        <div className="flex flex-col items-start gap-1">
          <Badge
            tone={
              m.status === "active"
                ? "sage"
                : m.status === "paused"
                  ? "warning"
                  : m.status === "cancelled"
                    ? "error"
                    : "neutral"
            }
          >
            {m.status}
          </Badge>
          {m.status === "paused" && m.pausedUntil && (
            <span className="text-xs text-muted">until {m.pausedUntil}</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <DataTable<Membership>
        rows={memberships}
        columns={columns}
        rowKey={(m) => m.id}
        actions={(m) => (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => open(m, "pause")}
              disabled={m.status !== "active"}
            >
              Pause
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => open(m, "change")}
              disabled={m.status === "cancelled"}
            >
              Change plan
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => open(m, "cancel")}
              disabled={m.status === "cancelled"}
            >
              Cancel
            </Button>
          </div>
        )}
        empty={
          <EmptyState
            title="No memberships"
            description="Active memberships and pause/cancel history will appear here."
          />
        }
      />

      <Dialog
        open={action === "pause"}
        onOpenChange={(o) => !o && close()}
        title="Pause membership"
        description="Resumes automatically on the chosen date."
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink">Resume on</label>
            <Input type="date" value={resumeAt} onChange={(e) => setResumeAt(e.target.value)} />
          </div>
          <Input
            placeholder="Audit note (required)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="button" onClick={submit}>
            Pause
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={action === "cancel"}
        onOpenChange={(o) => !o && close()}
        title="Cancel membership"
        description="Cancels the recurring plan. Existing credits are not affected."
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink">Effective date</label>
            <Input
              type="date"
              value={effectiveAt}
              onChange={(e) => setEffectiveAt(e.target.value)}
            />
          </div>
          <Input
            placeholder="Reason (required)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Back
          </Button>
          <Button type="button" variant="danger" onClick={submit}>
            Cancel membership
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={action === "change"}
        onOpenChange={(o) => !o && close()}
        title="Change plan"
        description="Switch to another membership product. Audit-logged."
      >
        <div className="space-y-3">
          <Select value={newProductId} onChange={(e) => setNewProductId(e.target.value)}>
            {membershipProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
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
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="button" onClick={submit}>
            Change plan
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
