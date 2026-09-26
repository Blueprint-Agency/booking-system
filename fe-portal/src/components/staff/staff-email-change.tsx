"use client";
import { useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { Badge, Button, DialogFooter, Input, Label } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { formatRelative } from "@/lib/formatters";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { useWorkspace } from "@/lib/workspace-context";
import type { PendingEmail, StaffEditableFields } from "./staff-edit-dialog";

/** The refusal's own words when the API sent some, else the fallback. */
function refusalMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message ?? fallback;
  }
  return fallback;
}

/** Save an address as Unverified and mail it the link; the same address again is a resend. */
function useSendLink(staffId: string) {
  const { api } = useWorkspace();
  return async (address: string): Promise<PendingEmail> => {
    if (!api) throw new Error("no api");
    const res = await api.post<{ pending_email: PendingEmail }>(`/portal/admin/staff/${staffId}/email`, {
      email: address,
    });
    return res.pending_email;
  };
}

/**
 * Change a staff member's sign-in email, verified by link: the new address is
 * saved as Unverified and sent a confirmation link, and the sign-in moves only
 * once that link is clicked. One step inside the staff dialog; the Unverified
 * address then shows in the dialog's view (`PendingEmailNotice`).
 *
 * `isSelf` changes only the words.
 */
export function StaffEmailChange({
  staff,
  isSelf,
  onSent,
  onCancel,
}: {
  staff: StaffEditableFields;
  isSelf: boolean;
  /** The Unverified address, as the API echoes it. */
  onSent: (pending: PendingEmail) => void;
  onCancel: () => void;
}) {
  const sendLink = useSendLink(staff.id);
  const [email, setEmail] = useState(staff.pending_email?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstName = staff.first_name || staff.email.split("@")[0];
  const typed = email.trim().toLowerCase();
  const ready = typed !== "" && typed !== staff.email.trim().toLowerCase();
  const noEmailYet = isPlaceholderEmail(staff.email);

  async function send() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      onSent(await sendLink(typed));
    } catch (err) {
      setError(refusalMessage(err, "The link could not be sent. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const hint = isSelf
    ? "We'll email a confirmation link to the new address. It shows as Unverified until you click it — until then you keep signing in with your current email."
    : noEmailYet
      ? `We'll email a confirmation link to the new address. It shows as Unverified until ${firstName} clicks it.`
      : `We'll email a confirmation link to the new address. It shows as Unverified until ${firstName} clicks it — until then they keep signing in with their current email.`;

  return (
    <form
      className="space-y-4"
      onSubmit={e => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="rounded-lg border border-border bg-paper px-3 py-2.5 text-sm">
        <p className="text-xs uppercase tracking-wider text-muted">Current email</p>
        <p className="mt-0.5 break-all text-ink">
          {noEmailYet ? "No email — imported without one" : staff.email}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="staff-new-email">New email</Label>
        <Input
          id="staff-new-email"
          type="email"
          inputMode="email"
          required
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={e => {
            setEmail(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby="staff-new-email-hint"
        />
        {error ? (
          <p id="staff-new-email-hint" role="alert" className="text-xs text-error">
            {error}
          </p>
        ) : (
          <p id="staff-new-email-hint" className="text-xs text-muted">
            {hint}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready || busy}>
          {busy ? "Sending…" : "Send link"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * An address saved but not yet confirmed, under the staff member's email: the
 * address, labelled Unverified (or its link expired), and — for an admin who
 * may change it — Resend and Revoke.
 */
export function PendingEmailNotice({
  staff,
  canManage,
  onChange,
}: {
  staff: StaffEditableFields & { pending_email: PendingEmail };
  canManage: boolean;
  /** The resent address, or null once revoked. */
  onChange: (pending: PendingEmail | null) => void;
}) {
  const { api } = useWorkspace();
  const sendLink = useSendLink(staff.id);
  const [busy, setBusy] = useState<"resend" | "revoke" | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const pending = staff.pending_email;
  const noEmailYet = isPlaceholderEmail(staff.email);

  async function resend() {
    setBusy("resend");
    setNote(null);
    try {
      onChange(await sendLink(pending.email));
      setNote({ text: `A new link was sent to ${pending.email}.`, error: false });
    } catch (err) {
      setNote({ text: refusalMessage(err, "The link could not be sent. Try again."), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    if (!api) return;
    setBusy("revoke");
    setNote(null);
    try {
      await api.del(`/portal/admin/staff/${staff.id}/email`);
      onChange(null);
    } catch (err) {
      setNote({ text: refusalMessage(err, "It could not be revoked. Try again."), error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-border bg-paper px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-all font-medium text-ink">{pending.email}</span>
        {pending.expired ? <Badge tone="error">Link expired</Badge> : <Badge tone="warning">Unverified</Badge>}
      </div>
      <p className="mt-1 text-xs text-muted">
        {pending.expired
          ? "The confirmation link expired before it was clicked. Resend it, or revoke the change."
          : `Confirmation link sent ${formatRelative(pending.sent_at)}, expires ${formatRelative(pending.expires_at)}.`}{" "}
        {noEmailYet
          ? "It becomes the sign-in email once the link is clicked."
          : `${staff.email} still signs in until then.`}
      </p>
      {note && (
        <p role={note.error ? "alert" : "status"} className={`mt-1 text-xs ${note.error ? "text-error" : "text-sage"}`}>
          {note.text}
        </p>
      )}
      {canManage && (
        <div className="mt-2 flex flex-wrap justify-end gap-1">
          <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void resend()}>
            <RefreshCw className="h-3.5 w-3.5" /> {busy === "resend" ? "Sending…" : "Resend link"}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void revoke()}>
            <X className="h-3.5 w-3.5" /> {busy === "revoke" ? "Revoking…" : "Revoke"}
          </Button>
        </div>
      )}
    </div>
  );
}
