"use client";
import { useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { ApiError, type Api } from "@/lib/api";
import {
  clearPaymentCredentials,
  setPaymentCredentials,
  type PlatformTenant,
} from "@/lib/platform";

/**
 * Move a studio onto its own payment-provider account.
 *
 * The credentials belong to the studio, not to the platform: its money is taken
 * on its own account and lands in its own bank, and this is the one surface
 * anywhere that can set them.
 *
 * It is deliberately write-only. There is no field showing what is stored, not
 * even masked or last-four, because nothing is stored that anyone can read —
 * the secrets are encrypted with a key the browser never sees and no route
 * returns them. So the form is always empty, whether the studio has an account
 * or not, and a studio whose credentials look wrong is fixed by replacing them
 * or by clearing them and starting again.
 *
 * What the operator does see is the account the provider itself says the key
 * belongs to. That is the check that matters: it catches the one mistake this
 * form can make and nothing else would — pasting the wrong studio's key.
 */
export interface PaymentCredentialsDialogProps {
  api: Api;
  tenant: PlatformTenant | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function PaymentCredentialsDialog({
  api,
  tenant,
  onOpenChange,
  onSaved,
}: PaymentCredentialsDialogProps) {
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clearing, setClearing] = useState(false);
  /** The server's refusal of the key, shown under the field it is about. */
  const [keyError, setKeyError] = useState<string | null>(null);

  const setup = tenant?.payments.setup;
  // Said as soon as it is typed, but the backend is what enforces it.
  const wrongMode = Boolean(
    setup && secretKey.trim() && !secretKey.trim().startsWith(setup.key_prefix),
  );
  const busy = submitting || clearing;
  const canSubmit = Boolean(
    !busy && tenant && secretKey.trim() && webhookSecret.trim() && !wrongMode,
  );

  function wrongModeMessage(prefix: string): string {
    return prefix === "sk_live_"
      ? "This is production: only live keys (sk_live_…) are accepted. A test key would take no real money."
      : "This environment accepts only test keys (sk_test_…). A live key would take real money.";
  }

  function codeOf(err: unknown): string | undefined {
    return err instanceof ApiError && err.body && typeof err.body === "object"
      ? (err.body as { error?: string }).error
      : undefined;
  }

  function messageFor(err: unknown, fallback: string): string {
    const code = codeOf(err);
    if (code === "provider_key_rejected") {
      return "The payment provider refused that secret key. Check it was copied whole, and from the right account.";
    }
    if (code === "secret_storage_unavailable") {
      return "This server has no key to encrypt credentials with, so it will not store them. Set PAYMENT_CREDENTIALS_KEY and redeploy.";
    }
    return fallback;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || !tenant) return;

    setSubmitting(true);
    setKeyError(null);
    try {
      const result = await setPaymentCredentials(api, tenant.id, {
        secret_key: secretKey.trim(),
        webhook_secret: webhookSecret.trim(),
      });
      // Cleared at once. A live key sitting in a form field is a live key on
      // screen, and this dialog can be left open.
      setSecretKey("");
      setWebhookSecret("");
      toast.success(
        `${tenant.name} now charges on ${result.tenant.payments.account_id}.`,
      );
      onSaved();
    } catch (err) {
      if (codeOf(err) === "provider_key_wrong_mode") {
        const expected = (err as ApiError).body as { expected_prefix?: string };
        setKeyError(wrongModeMessage(expected.expected_prefix ?? tenant.payments.setup.key_prefix));
        return;
      }
      toast.error(messageFor(err, `Could not save credentials for ${tenant.name}.`));
    } finally {
      setSubmitting(false);
    }
  }

  async function clear() {
    if (!tenant) return;
    if (
      !window.confirm(
        `Put ${tenant.name} back on the platform account? Its stored credentials are destroyed and cannot be recovered — they would have to be entered again.`,
      )
    ) {
      return;
    }

    setClearing(true);
    try {
      await clearPaymentCredentials(api, tenant.id);
      toast.success(`${tenant.name} is back on the platform account.`);
      onSaved();
    } catch (err) {
      toast.error(messageFor(err, `Could not clear credentials for ${tenant.name}.`));
    } finally {
      setClearing(false);
    }
  }

  return (
    <Dialog
      open={Boolean(tenant)}
      onOpenChange={onOpenChange}
      title="Payment account"
      description={
        tenant
          ? tenant.payments.configured
            ? `${tenant.name} charges on its own account (${tenant.payments.account_id}). Entering credentials here replaces them.`
            : `${tenant.name} charges on the platform account. Entering its own credentials moves its money onto its own account.`
          : ""
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {setup && (
          <div className="rounded-md border border-border bg-surface p-3">
            <p className="text-sm font-medium text-ink">
              First, add a webhook endpoint on the studio’s own account
            </p>
            <p className="mt-1 text-xs text-muted">
              Its signing secret is what the form below asks for. Until the endpoint exists,
              the studio’s purchases are charged but nothing is granted.
            </p>
            <p className="mt-3 text-xs font-medium text-ink">Endpoint URL</p>
            <CopyLine value={setup.webhook_url} label="webhook URL" />
            <p className="mt-2 text-xs font-medium text-ink">Events to send</p>
            {setup.webhook_events.map(event => (
              <CopyLine key={event} value={event} label={`event ${event}`} />
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment-secret-key">Secret key</Label>
          <Input
            id="payment-secret-key"
            type="password"
            autoComplete="off"
            value={secretKey}
            onChange={e => {
              setSecretKey(e.target.value);
              setKeyError(null);
            }}
            placeholder={`${setup?.key_prefix ?? "sk_"}…`}
            aria-invalid={wrongMode || Boolean(keyError)}
            aria-describedby="payment-secret-key-help"
            autoFocus
            required
          />
          {setup && (wrongMode || keyError) ? (
            <p id="payment-secret-key-help" className="text-xs text-error" role="alert">
              {keyError ?? wrongModeMessage(setup.key_prefix)}
            </p>
          ) : (
            <p id="payment-secret-key-help" className="text-xs text-muted">
              Checked against the provider before it is stored, so a wrong key is caught here
              rather than at a member’s checkout.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment-webhook-secret">Webhook signing secret</Label>
          <Input
            id="payment-webhook-secret"
            type="password"
            autoComplete="off"
            value={webhookSecret}
            onChange={e => setWebhookSecret(e.target.value)}
            placeholder="whsec_…"
            required
          />
          <p className="text-xs text-muted">
            From the webhook endpoint on the studio’s own account. Nothing can verify it in
            advance — the first delivery that arrives proves it.
          </p>
        </div>

        <p className="text-xs text-muted">
          Saved keys can’t be viewed again, by anyone. To change them, enter new ones here;
          to undo them, put the studio back on the platform account.
        </p>

        <DialogFooter>
          {tenant?.payments.configured && (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void clear()}>
              {clearing && <Loader2 className="h-4 w-4 animate-spin" />}
              Back to platform account
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {tenant?.payments.configured ? "Replace credentials" : "Save credentials"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** One value the operator has to paste into the provider's dashboard, with a copy button. */
function CopyLine({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy — select the text and copy it by hand.");
    }
  }

  return (
    <div className="mt-1 flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-paper px-2 py-1 font-mono text-xs text-ink">
        {value}
      </code>
      <Button
        type="button"
        variant="secondary"
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}
