"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, Button } from "@/components/ui";
import { ReasonRequiredDialog } from "@/components/dialogs/reason-required-dialog";
import { resetAllWaivers } from "@/lib/mutations/waivers";

export default function BulkWaiverResetPage() {
  const signed = useAdminState((s) => s.clients.filter((c) => c.waiverSigned).length);
  const [open, setOpen] = useState(false);

  const onConfirm = async (reason: string) => {
    try {
      const count = resetAllWaivers(reason);
      toast.success(`Reset waiver for ${count} client${count === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <>
      <PageHeader
        title="Bulk waiver reset"
        description="Force every signed client to re-sign on next booking. Use after a waiver text revision."
      />
      <div className="mt-6 max-w-lg space-y-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Currently signed</div>
          <div className="mt-1 text-3xl font-semibold text-ink">{signed}</div>
        </div>
        <div className="rounded-lg border border-error/30 bg-error/5 p-4 text-sm text-ink">
          <strong>Heads up:</strong> this writes one audit row for the bulk action. All affected
          clients will be prompted at their next booking attempt.
        </div>
        <div>
          <Button variant="danger" onClick={() => setOpen(true)} disabled={signed === 0}>
            Reset {signed} waiver{signed === 1 ? "" : "s"}
          </Button>
        </div>
      </div>

      <ReasonRequiredDialog
        open={open}
        onOpenChange={setOpen}
        title="Bulk reset waivers"
        description="Reason for the bulk reset (waiver revision, regulatory change, etc)."
        confirmLabel="Reset all"
        confirmVariant="danger"
        onConfirm={onConfirm}
      />
    </>
  );
}
