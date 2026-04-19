"use client";

import { useState } from "react";
import type { PrivateRequest } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { approveRequest } from "@/lib/mock-state";

export function AcceptRequestModal({
  request,
  open,
  onClose,
}: {
  request: PrivateRequest;
  open: boolean;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const submit = () => {
    const slot = request.proposedSlots[idx];
    if (!slot) return;
    approveRequest(request.id, { date: slot.date, time: slot.time });
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Accept request">
      <p className="mb-3 text-sm text-ink/70">Pick a time from the client&apos;s proposed slots.</p>
      <div className="space-y-2">
        {request.proposedSlots.map((s, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            className={
              "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm " +
              (idx === i ? "border-accent bg-accent/10" : "border-ink/10 bg-white hover:bg-paper/40")
            }
          >
            <span className="font-mono text-ink">
              {s.date} · {s.time}
            </span>
            {idx === i && <span className="text-xs text-accent">Selected</span>}
          </button>
        ))}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={request.proposedSlots.length === 0}>Approve</Button>
      </div>
    </Modal>
  );
}
