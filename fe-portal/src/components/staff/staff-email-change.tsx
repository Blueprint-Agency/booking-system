"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, MailCheck } from "lucide-react";
import { OtpInput } from "@/components/auth/otp-input";
import { Button, DialogFooter, Input, Label } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { useWorkspace } from "@/lib/workspace-context";
import type { StaffEditableFields } from "./staff-edit-dialog";

const CODE_LENGTH = 6;

/** The refusal's own words when the API sent some, else the fallback. */
function refusalMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message ?? fallback;
  }
  return fallback;
}

/**
 * Change a staff member's sign-in email, verified: a code is mailed to the new
 * address and nothing moves until it comes back. Two steps inside the staff
 * dialog rather than a second overlay on top of it.
 *
 * `isSelf` changes only the words: for someone else, the admin asks them for
 * the code; for their own address, they read it themselves.
 */
export function StaffEmailChange({
  staff,
  isSelf,
  onDone,
  onCancel,
}: {
  staff: StaffEditableFields;
  isSelf: boolean;
  /** The confirmed row, as the API echoes it. */
  onDone: (updated: StaffEditableFields) => void;
  onCancel: () => void;
}) {
  const { api } = useWorkspace();
  const [step, setStep] = useState<"address" | "code">("address");
  const [email, setEmail] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  // Whether a code is out, so leaving the flow can withdraw it.
  const pending = useRef(false);
  // A request in flight. A ref, not `busy`: the sixth digit confirms by itself,
  // and an Enter pressed in the same moment reads a render-old `busy`.
  const inFlight = useRef(false);

  const firstName = staff.first_name || staff.email.split("@")[0];
  const typed = email.trim().toLowerCase();
  const ready = typed !== "" && typed !== staff.email.trim().toLowerCase();

  // The resend countdown, a second at a time.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Leaving with a code out withdraws it, so it cannot be used later.
  useEffect(
    () => () => {
      if (pending.current) void api?.del(`/portal/admin/staff/${staff.id}/email`).catch(() => {});
    },
    [api, staff.id],
  );

  async function sendCode(address: string) {
    if (!api || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ pending_email: string; resend_after_seconds: number }>(
        `/portal/admin/staff/${staff.id}/email`,
        { email: address },
      );
      pending.current = true;
      setPendingEmail(res.pending_email);
      setResendIn(res.resend_after_seconds);
      setCode("");
      setStep("code");
    } catch (err) {
      setError(refusalMessage(err, "The code could not be sent. Try again."));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function confirm(value: string) {
    if (!api || value.length !== CODE_LENGTH || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.post<StaffEditableFields>(
        `/portal/admin/staff/${staff.id}/email/confirm`,
        { code: value },
      );
      pending.current = false;
      onDone(updated);
    } catch (err) {
      setError(refusalMessage(err, "The code could not be checked. Try again."));
      setCode("");
      // Spent or expired: the only way on is a new code.
      if (
        err instanceof ApiError &&
        ["email_change_code_expired", "email_change_not_requested"].includes(
          (err.body as { error?: string } | null)?.error ?? "",
        )
      ) {
        pending.current = false;
        // Nothing is left on the server to wait out.
        setResendIn(0);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  // The code out stays valid until the next one replaces it, so there is
  // nothing to withdraw here — and a withdrawal still in flight when the next
  // code is sent could land after it and delete it. The resend wait carries
  // over: it is the server's, for any address.
  function backToAddress() {
    setError(null);
    setCode("");
    setEmail(pendingEmail);
    setStep("address");
  }

  if (step === "address") {
    return (
      <form
        className="space-y-4"
        onSubmit={e => {
          e.preventDefault();
          if (ready && resendIn <= 0) void sendCode(typed);
        }}
      >
        <div className="rounded-lg border border-border bg-paper px-3 py-2.5 text-sm">
          <p className="text-xs uppercase tracking-wider text-muted">Current email</p>
          <p className="mt-0.5 break-all text-ink">
            {isPlaceholderEmail(staff.email) ? "No email — imported without one" : staff.email}
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
              {isSelf
                ? "We'll email a 6-digit code to the new address. Your email changes once you enter it."
                : `We'll email a 6-digit code to the new address. Ask ${firstName} for it — their email changes once it's entered.`}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready || busy || resendIn > 0}>
            {busy ? "Sending…" : resendIn > 0 ? `Send code in ${resendIn}s` : "Send code"}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={e => {
        e.preventDefault();
        void confirm(code);
      }}
    >
      <div className="flex gap-3 rounded-lg border border-border bg-paper px-3 py-3 text-sm">
        <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <p className="min-w-0 text-ink">
          Code sent to <span className="break-all font-medium">{pendingEmail}</span>.{" "}
          <span className="text-muted">
            {isSelf
              ? "Enter it below. It expires in 10 minutes."
              : `Ask ${firstName} to read it to you from that inbox. It expires in 10 minutes.`}
          </span>
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="staff-email-code">6-digit code</Label>
        <div id="staff-email-code">
          <OtpInput
            value={code}
            autoFocus
            onChange={v => {
              setCode(v);
              setError(null);
              // A full code confirms itself — no reaching for the button on a phone.
              if (v.length === CODE_LENGTH) void confirm(v);
            }}
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-error">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <button
          type="button"
          onClick={backToAddress}
          disabled={busy}
          className="inline-flex min-h-10 items-center gap-1.5 text-muted hover:text-ink disabled:opacity-50 sm:min-h-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Use a different email
        </button>
        <button
          type="button"
          onClick={() => void sendCode(pendingEmail)}
          disabled={busy || resendIn > 0}
          className="inline-flex min-h-10 items-center font-medium text-accent hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline sm:min-h-0"
        >
          {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
        </button>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || code.length !== CODE_LENGTH}>
          {busy ? "Confirming…" : "Confirm change"}
        </Button>
      </DialogFooter>
    </form>
  );
}
