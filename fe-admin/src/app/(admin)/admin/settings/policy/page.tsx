"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { Button, Input, Label } from "@/components/ui";
import { updatePolicy } from "@/lib/mutations/settings";

export default function PolicySettingsPage() {
  const policy = useAdminState((s) => s.policy);
  const [classCancel, setClassCancel] = useState(policy.classCancelHours);
  const [privateCancel, setPrivateCancel] = useState(policy.privateCancelHours);
  const [sla, setSla] = useState(policy.privateSlaHours);
  const [lastMin, setLastMin] = useState(policy.lastMinuteThreshold);

  const save = () => {
    updatePolicy({
      classCancelHours: Number(classCancel),
      privateCancelHours: Number(privateCancel),
      privateSlaHours: Number(sla),
      lastMinuteThreshold: Number(lastMin),
    });
    toast.success("Policy updated");
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label>Class cancellation window (hours)</Label>
          <Input
            type="number"
            min={0}
            value={classCancel}
            onChange={(e) => setClassCancel(Number(e.target.value))}
          />
        </div>
        <div>
          <Label>Private cancellation window (hours)</Label>
          <Input
            type="number"
            min={0}
            value={privateCancel}
            onChange={(e) => setPrivateCancel(Number(e.target.value))}
          />
        </div>
        <div>
          <Label>Private confirmation SLA (hours)</Label>
          <Input
            type="number"
            min={0}
            value={sla}
            onChange={(e) => setSla(Number(e.target.value))}
          />
        </div>
        <div>
          <Label>Last-minute threshold (hours)</Label>
          <Input
            type="number"
            min={0}
            value={lastMin}
            onChange={(e) => setLastMin(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={save}>
          Save policy
        </Button>
      </div>
      <p className="text-xs text-muted">
        Changes propagate to <code className="font-mono">CancelWithPolicyDialog</code> and SLA calculations on next render. Audit-logged.
      </p>
    </div>
  );
}
