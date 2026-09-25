"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
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
 *
 * One field (#294). The webhook endpoint on the studio's account is created by
 * the platform when the key is saved, so there is no URL to register by hand
 * and no signing secret to copy back.
 */
/** What a refusal from the credentials route may carry. */
type RefusalBody = { error?: string; expected_prefix?: string; required_permission?: string };

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
  const [submitting, setSubmitting] = useState(false);
  const [clearing, setClearing] = useState(false);
  /** The server's refusal of the key, shown under the field it is about. */
  const [keyError, setKeyError] = useState<string | null>(null);

  const setup = tenant?.payments.setup;
  // Said as soon as it is typed, but the backend is what enforces it. A
  // restricted key (`rk_…`) of the same mode is accepted too.
  const wrongMode = Boolean(
    setup && secretKey.trim() && !keyOfMode(secretKey.trim(), setup.key_prefix),
  );
  const busy = submitting || clearing;
  const canSubmit = Boolean(!busy && tenant && secretKey.trim() && !wrongMode);

  function wrongModeMessage(prefix: string): string {
    return prefix === "sk_live_"
      ? "This is production: only live keys (sk_live_…) are accepted. A test key would take no real money."
      : "This environment accepts only test keys (sk_test_…). A live key would take real money.";
  }

  /** The refusal's JSON body, when the server sent one. */
  function bodyOf(err: unknown): RefusalBody {
    return err instanceof ApiError && err.body && typeof err.body === "object"
      ? (err.body as RefusalBody)
      : {};
  }

  function codeOf(err: unknown): string | undefined {
    return bodyOf(err).error;
  }

  function messageFor(err: unknown, fallback: string): string {
    const code = codeOf(err);
    if (code === "provider_key_lacks_webhook_permission") {
      const permission = bodyOf(err).required_permission ?? "Webhook Endpoints: Write";
      return `This key can't set up the studio's webhook. Give it the "${permission}" permission in Stripe, or use the account's standard secret key.`;
    }
    if (code === "provider_webhook_refused") {
      return "Stripe accepted the key but would not create the studio's webhook endpoint. Stripe only delivers to public HTTPS addresses, so a local development server can't be set up this way.";
    }
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
      });
      // Cleared at once. A live key sitting in a form field is a live key on
      // screen, and this dialog can be left open.
      setSecretKey("");
      toast.success(
        `${tenant.name} now charges on ${result.tenant.payments.account_id}. Its webhook is set up at ${result.webhook.url}.`,
      );
      onSaved();
    } catch (err) {
      const code = codeOf(err);
      if (code === "provider_key_wrong_mode") {
        setKeyError(wrongModeMessage(bodyOf(err).expected_prefix ?? tenant.payments.setup.key_prefix));
        return;
      }
      // About the key itself, so said under the field rather than in a toast.
      if (code === "provider_key_lacks_webhook_permission") {
        setKeyError(messageFor(err, ""));
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
        `Remove ${tenant.name}'s payment credentials? It stops taking online payments straight away, and its webhook endpoint is deleted from its Stripe account. Its stored credentials are destroyed and cannot be recovered — they would have to be entered again.`,
      )
    ) {
      return;
    }

    setClearing(true);
    try {
      await clearPaymentCredentials(api, tenant.id);
      toast.success(`${tenant.name} has stopped taking online payments.`);
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
            ? `${tenant.name} charges on its own account (${tenant.payments.account_id}). Entering a new secret key here replaces it.`
            : `${tenant.name} isn't taking online payments — its payments are not set up. Entering its Stripe secret key lets it take them, on its own account.`
          : ""
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
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
              rather than at a member’s checkout. Saving it also sets up the studio’s webhook on
              its Stripe account.
            </p>
          )}
        </div>

        <p className="text-xs text-muted">
          A saved key can’t be viewed again, by anyone. To change it, enter a new one here;
          removing it stops the studio taking online payments.
        </p>

        <DialogFooter>
          {tenant?.payments.configured && (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void clear()}>
              {clearing && <Loader2 className="h-4 w-4 animate-spin" />}
              Stop online payments
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {tenant?.payments.configured ? "Replace key" : "Save key"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** Whether a key is of the mode `prefix` names — its `sk_` or restricted `rk_` form. */
function keyOfMode(key: string, prefix: string): boolean {
  const mode = prefix.slice("sk_".length);
  return key.startsWith(`sk_${mode}`) || key.startsWith(`rk_${mode}`);
}
