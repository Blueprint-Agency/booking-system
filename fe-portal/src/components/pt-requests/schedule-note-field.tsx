"use client";
import { Label, Textarea } from "@/components/ui";

/**
 * A note to the member when staff schedule a time the member did not propose
 * (`ptOffProposal`), saying why. Optional; the member reads it beside their
 * session. The caller renders it only when the time is off the proposals.
 */
export function ScheduleNoteField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (note: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
      <Label htmlFor={id}>Note to the member · optional</Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="e.g. Your times were taken, so we agreed this one on WhatsApp."
        disabled={disabled}
      />
      <p className="text-xs text-muted">
        This time isn&apos;t one the member proposed. They see this note beside the session.
      </p>
    </div>
  );
}
