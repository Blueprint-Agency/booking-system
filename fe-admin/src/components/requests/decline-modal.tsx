"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { declineRequest } from "@/lib/mock-state";

export function DeclineRequestModal({
  requestId,
  open,
  onClose,
}: {
  requestId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const submit = () => {
    if (!reason.trim()) return;
    declineRequest(requestId, reason.trim());
    setReason("");
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Decline request">
      <Label htmlFor="dec-reason">Reason (shown to client)</Label>
      <Textarea
        id="dec-reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="No instructor availability this week, etc."
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          variant="danger"
          onClick={submit}
          disabled={!reason.trim()}
        >
          Decline
        </Button>
      </div>
    </Modal>
  );
}
