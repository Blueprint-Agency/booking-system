"use client";

import { useState } from "react";
import { Button, Textarea, Label } from "@/components/ui";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

interface ReasonRequiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger";
  onConfirm: (reason: string) => void | Promise<void>;
}

export function ReasonRequiredDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  confirmVariant = "primary",
  onConfirm,
}: ReasonRequiredDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onConfirm(trimmed);
      setReason("");
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="space-y-2">
        <Label>Reason (required)</Label>
        <Textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="What's the reason for this action?"
          autoFocus
        />
      </div>
      <DialogFooter>
        <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant={confirmVariant} type="button" disabled={!canSubmit} onClick={submit}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
