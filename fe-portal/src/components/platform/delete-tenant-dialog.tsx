"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { ApiError, type Api } from "@/lib/api";
import { TENANT_REFUSALS, deleteTenant, type PlatformTenant } from "@/lib/platform";

/**
 * Delete a studio, for good.
 *
 * The one irreversible button in the super portal, so it asks for the studio's
 * address typed out — not a checkbox, not "yes" — and the backend checks the
 * same thing again. Offered only for a suspended (or archived) studio: the
 * backend refuses an active one, and suspending first is the reversible step
 * that proves nobody is working in it.
 */
export interface DeleteTenantDialogProps {
  api: Api;
  tenant: PlatformTenant | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (tenant: PlatformTenant) => void;
}

export function DeleteTenantDialog({ api, tenant, onOpenChange, onDeleted }: DeleteTenantDialogProps) {
  // The parent keys this component on the studio, so the field starts empty
  // for each studio rather than carrying one studio's typing into the next.
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const matches = Boolean(tenant && typed.trim().toLowerCase() === tenant.slug);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!tenant || !matches) return;
    setSubmitting(true);
    try {
      const { deleted } = await deleteTenant(api, tenant.id, typed.trim().toLowerCase());
      toast.success(`${tenant.name} was deleted — ${deleted.rows.toLocaleString()} rows removed.`);
      onDeleted(tenant);
    } catch (err) {
      const code =
        err instanceof ApiError && err.body && typeof err.body === "object"
          ? (err.body as { error?: string }).error
          : undefined;
      toast.error(
        code && TENANT_REFUSALS[code]
          ? TENANT_REFUSALS[code]
          : `Could not delete ${tenant.name}. Nothing was deleted.`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={Boolean(tenant)}
      onOpenChange={onOpenChange}
      title="Delete studio"
      description={tenant ? `Permanently delete ${tenant.name} and everything it holds.` : ""}
    >
      {tenant && (
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="rounded-lg border border-error/40 bg-error/5 p-3 text-sm text-ink">
            <p>
              Every member, booking, class, package, payment record, staff account and setting
              belonging to <span className="font-medium">{tenant.name}</span> is deleted, along with
              its uploaded files. Members and staff who belong only to this studio lose their
              sign-in. <span className="font-medium">This cannot be undone.</span>
            </p>
            <p className="mt-2 text-muted">
              Export the studio first if there is any chance you will want it back.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-confirm">
              Type <span className="font-mono">{tenant.slug}</span> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={!matches || submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete forever
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}
