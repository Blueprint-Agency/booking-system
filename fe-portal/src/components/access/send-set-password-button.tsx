"use client";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

/**
 * Mail a member the link that sets their password (#173) — for a member who
 * never received theirs, or lost it. The same link their own sign-in sends.
 */
export function SendSetPasswordButton({ clientId, email }: { clientId: string; email: string }) {
  const { api } = useWorkspace();
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!api) return;
    setBusy(true);
    try {
      await api.post<{ sent: true }>(`/portal/admin/clients/${clientId}/send-set-password`, {});
      toast.success(`Set-password link sent to ${email}.`);
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { error?: string; message?: string } | null) : null;
      const reason = body?.error ?? body?.message;
      toast.error(
        reason === "too_many_requests"
          ? "Too many links sent just now. Wait a few minutes, then try again."
          : reason ?? (err instanceof ApiError ? `Sending failed (HTTP ${err.status}).` : "Sending failed."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="ghost" disabled={busy} onClick={send}>
      <KeyRound className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Send set-password link"}
    </Button>
  );
}
