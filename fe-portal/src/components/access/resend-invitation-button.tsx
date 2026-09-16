"use client";
import { useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

/**
 * Re-mail a staff member the link that sets their password (#119): their
 * invitation while it is pending, a set-password link once there is none.
 */
export function ResendInvitationButton({ staffId, email }: { staffId: string; email: string }) {
  const { api } = useWorkspace();
  const [busy, setBusy] = useState(false);

  async function resend() {
    if (!api) return;
    setBusy(true);
    try {
      const { sent } = await api.post<{ sent: "invitation" | "set_password" }>(
        `/portal/admin/staff/${staffId}/resend-invitation`,
        {},
      );
      toast.success(
        sent === "invitation" ? `Invitation re-sent to ${email}.` : `Set-password link sent to ${email}.`,
      );
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { error?: string; message?: string } | null) : null;
      toast.error(body?.message ?? body?.error ?? (err instanceof ApiError ? `Resend failed (HTTP ${err.status}).` : "Resend failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="ghost" disabled={busy} onClick={resend}>
      <Mail className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Resend invitation"}
    </Button>
  );
}
