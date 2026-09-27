"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Dialog, DialogFooter, Label, Textarea } from "@/components/ui";
import { ptNoteOrNull } from "@/lib/pt-requests";

/**
 * Staff cancelling a PT request or its session: what happens to the sessions
 * held, and an optional reason the member reads on their booking. Every staff
 * cancel of a private session goes through here — the PT Requests queue, and
 * the session's page for an admin and for the instructor who runs it.
 *
 * `onConfirm` does the cancel and throws to refuse; its message stays in the
 * dialog so the reason typed is not lost.
 */
export function CancelPtDialog({
  open,
  onOpenChange,
  title,
  consequence,
  onConfirm,
  errorMessage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Cancel request" while pending, "Cancel session" once scheduled. */
  title: string;
  /** What the cancel does to the member's sessions. */
  consequence: string;
  onConfirm: (note: string | null) => Promise<void>;
  /** The sentence for a refusal, from the page's own error copy. */
  errorMessage: (err: unknown) => string;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh form each time it opens: last time's reason was for another request.
  useEffect(() => {
    if (!open) return;
    setNote("");
    setError(null);
  }, [open]);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm(ptNoteOrNull(note));
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)} title={title} description={consequence}>
      <form onSubmit={handleConfirm} className="space-y-1.5">
        <Label htmlFor="pt-cancel-note">Reason · optional</Label>
        <Textarea
          id="pt-cancel-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="e.g. The instructor is unwell that day."
          disabled={busy}
        />
        <p className="text-xs text-muted">The member sees this on their booking.</p>
        {error && (
          <p role="alert" className="pt-2 text-sm text-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep it
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {title}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
