"use client";

import { useState } from "react";
import type { Client, ClientPackage, Product } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { adjustClientCredits } from "@/lib/mock-state";

export function AdjustCreditsModal({
  client,
  clientPackages,
  products,
  open,
  onClose,
}: {
  client: Client;
  clientPackages: ClientPackage[];
  products: Product[];
  open: boolean;
  onClose: () => void;
}) {
  const activePackages = clientPackages.filter(
    (p) => p.clientId === client.id && p.status === "active",
  );
  const [packageId, setPackageId] = useState<string>(activePackages[0]?.id ?? "");
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");

  const submit = () => {
    if (!reason.trim() || delta === 0) return;
    adjustClientCredits({
      clientId: client.id,
      packageId: packageId || null,
      delta,
      reason: reason.trim(),
    });
    setDelta(0);
    setReason("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Adjust credits">
      <div className="space-y-3">
        <div>
          <Label htmlFor="ac-pkg">Package (optional)</Label>
          <Select id="ac-pkg" value={packageId} onChange={(e) => setPackageId(e.target.value)}>
            <option value="">— No specific package —</option>
            {activePackages.map((p) => {
              const prod = products.find((x) => x.id === p.productId);
              return (
                <option key={p.id} value={p.id}>
                  {prod?.name ?? p.productId} · {p.creditsRemaining}/{p.creditsTotal} left
                </option>
              );
            })}
          </Select>
        </div>
        <div>
          <Label htmlFor="ac-delta">Delta (positive = add, negative = deduct)</Label>
          <Input
            id="ac-delta"
            type="number"
            value={delta}
            onChange={(e) => setDelta(Number(e.target.value))}
          />
        </div>
        <div>
          <Label htmlFor="ac-reason">Reason</Label>
          <Textarea
            id="ac-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Manual refund, goodwill credit, correction, etc."
          />
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!reason.trim() || delta === 0}>
          Apply adjustment
        </Button>
      </div>
    </Modal>
  );
}
