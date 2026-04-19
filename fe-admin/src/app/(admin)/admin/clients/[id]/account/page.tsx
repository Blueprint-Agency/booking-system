"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { Badge, Button } from "@/components/ui";
import { ReasonRequiredDialog } from "@/components/dialogs/reason-required-dialog";
import { resetWaiver } from "@/lib/mutations/waivers";

export default function ClientAccountPage() {
  const { id } = useParams<{ id: string }>();
  const client = useAdminState((s) => s.clients.find((c) => c.id === id));
  const [resetOpen, setResetOpen] = useState(false);

  if (!client) return null;

  const onResetWaiver = (reason: string) => {
    try {
      resetWaiver(client.id, reason);
      toast.success("Waiver reset");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset waiver");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Account</h3>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Status</dt>
            <dd className="mt-0.5">
              <Badge tone={client.activityStatus === "active" ? "sage" : "neutral"}>
                {client.activityStatus}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Joined</dt>
            <dd className="mt-0.5 text-ink">{client.registeredAt ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Home location</dt>
            <dd className="mt-0.5 text-ink">{client.primaryLocationId ?? "—"}</dd>
          </div>
        </dl>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Waiver</h3>
            <p className="mt-1 text-sm">
              {client.waiverSignedAt ? (
                <Badge tone="sage">Signed {client.waiverSignedAt}</Badge>
              ) : (
                <Badge tone="warning">Not signed</Badge>
              )}
            </p>
            <p className="mt-2 text-xs text-muted">
              Resetting requires the client to re-sign the waiver before their next booking.
            </p>
          </div>
          {client.waiverSignedAt && (
            <Button variant="secondary" onClick={() => setResetOpen(true)}>
              Reset waiver
            </Button>
          )}
        </div>
      </div>
      <ReasonRequiredDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset waiver"
        description={`This will require ${client.name} to re-sign the waiver. Reason will be recorded in audit.`}
        confirmLabel="Reset waiver"
        onConfirm={onResetWaiver}
      />
    </div>
  );
}
