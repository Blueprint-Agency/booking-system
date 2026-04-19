"use client";

import { useState } from "react";
import type { Session } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cancelSession } from "@/lib/mock-state";

export function CancelSessionModal({
  session,
  open,
  onClose,
  onCancelled,
}: {
  session: Session;
  open: boolean;
  onClose: () => void;
  onCancelled?: (result: { creditsRefunded: number; clientsAffected: string[] }) => void;
}) {
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = () => {
    setConfirming(true);
    const result = cancelSession(session.id, reason.trim() || "No reason given");
    setConfirming(false);
    onCancelled?.(result);
    setReason("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Cancel session">
      <div className="space-y-4">
        <p className="text-sm text-ink/70">
          Cancelling <span className="font-semibold">{session.name}</span> on{" "}
          <span className="font-mono">{session.date}</span> at{" "}
          <span className="font-mono">{session.time}</span>. All{" "}
          <span className="font-semibold">{session.bookedCount}</span> booked clients will be
          auto-refunded one credit each.
        </p>
        <div>
          <Label htmlFor="cancel-reason">Reason</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Instructor sick, venue unavailable, etc."
            rows={3}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Keep session</Button>
          <Button variant="danger" onClick={handleConfirm} disabled={confirming}>
            Cancel session
          </Button>
        </div>
      </div>
    </Modal>
  );
}
