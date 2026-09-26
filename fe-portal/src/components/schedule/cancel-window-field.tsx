"use client";
import { useEffect, useState } from "react";
import { Input, Label } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { cancelWindowPlaceholder, fetchStudioClassWindow } from "@/lib/cancel-window";

/**
 * "Cancellation window (hours)" on the scheduling forms: this class's own
 * Cancellation Window, or blank to follow the studio's, which the placeholder names.
 * The text is kept as typed; `parseCancelWindow` turns it into the API's value
 * on submit.
 */
export function CancelWindowField({
  id = "cancel-window",
  value,
  onChange,
  hint = "Leave blank to follow the studio's cancellation policy.",
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
}) {
  const studioHours = useStudioClassWindow();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Cancellation window (hours)</Label>
      <Input
        id={id}
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        placeholder={cancelWindowPlaceholder(studioHours)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

/** The studio's class window, or null until read — and left null if the read fails. */
function useStudioClassWindow(): number | null {
  const { api } = useWorkspace();
  const [hours, setHours] = useState<number | null>(null);
  useEffect(() => {
    if (!api) return;
    let live = true;
    fetchStudioClassWindow(api).then(
      (h) => live && setHours(h),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api]);
  return hours;
}
