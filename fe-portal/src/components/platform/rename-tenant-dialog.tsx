"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { ApiError, type Api } from "@/lib/api";
import {
  SLUG_REASONS,
  checkSlug,
  renameTenant,
  type PlatformTenant,
  type SlugVerdict,
} from "@/lib/platform";

/**
 * Change a studio's address.
 *
 * Two steps, because a rename is the one change here that reaches outside the
 * platform: every bookmark, old email and QR poster the studio has handed out
 * starts going through a redirect. So the new slug is checked while it is typed
 * — by the backend, against the same rules as creation plus the old addresses
 * other renamed studios still hold — and then the old and new member and portal
 * addresses are shown side by side before anything happens, so a typo is caught
 * by a person rather than discovered by the studio's members.
 */
export interface RenameTenantDialogProps {
  api: Api;
  tenant: PlatformTenant | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: (tenant: PlatformTenant) => void;
}

export function RenameTenantDialog({ api, tenant, onOpenChange, onRenamed }: RenameTenantDialogProps) {
  const [slug, setSlug] = useState("");
  const [verdict, setVerdict] = useState<SlugVerdict | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // The parent keys this component on the studio, so a closed dialog remounts
  // empty: no state to reset here.

  useEffect(() => {
    if (!tenant || !slug || slug === tenant.slug) {
      setVerdict(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(async () => {
      try {
        const result = await checkSlug(api, slug);
        if (!cancelled) setVerdict(result);
      } catch {
        // The rename itself refuses the same slugs for the same reasons.
        if (!cancelled) setVerdict(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setChecking(false);
    };
  }, [api, tenant, slug]);

  const unchanged = Boolean(tenant && slug === tenant.slug);
  const slugProblem = unchanged
    ? "slug_unchanged"
    : verdict && !verdict.available
      ? verdict.reason
      : undefined;
  const canContinue = Boolean(!checking && slug && !unchanged && verdict?.available);

  async function submit() {
    if (!tenant || !canContinue) return;
    setSubmitting(true);
    try {
      const result = await renameTenant(api, tenant.id, slug);
      const until = new Date(result.former.redirect_until).toLocaleDateString();
      toast.success(
        `${tenant.name} now answers on “${result.tenant.slug}”. Old links redirect until ${until}.`,
      );
      onRenamed(result.tenant);
    } catch (err) {
      const code =
        err instanceof ApiError && err.body && typeof err.body === "object"
          ? (err.body as { error?: string }).error
          : undefined;
      toast.error(
        code && SLUG_REASONS[code] ? SLUG_REASONS[code] : `Could not rename ${tenant.name}. Nothing changed.`,
      );
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={Boolean(tenant)}
      onOpenChange={onOpenChange}
      title={confirming ? "Confirm the new address" : "Change address"}
      description={
        tenant
          ? confirming
            ? `Old links keep working for 90 days by redirecting. Members and staff sign in once at the new address.`
            : `${tenant.name} answers on “${tenant.slug}” today.`
          : ""
      }
    >
      {confirming && tenant ? (
        <div className="flex flex-col gap-4">
          <AddressMove label="Members" from={tenant.urls.client} to={verdict?.urls?.client ?? null} />
          <AddressMove label="Portal" from={tenant.urls.portal} to={verdict?.urls?.portal ?? null} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Back
            </Button>
            <Button type="button" disabled={submitting} onClick={() => void submit()}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Rename
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={event => {
            event.preventDefault();
            if (canContinue) setConfirming(true);
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-slug">New address</Label>
            <Input
              id="rename-slug"
              value={slug}
              onChange={e => setSlug(e.target.value.trim().toLowerCase())}
              placeholder={tenant?.slug}
              autoFocus
              required
              aria-invalid={Boolean(slugProblem)}
              aria-describedby="rename-slug-help"
            />
            <p id="rename-slug-help" className="text-xs text-muted">
              {checking ? (
                "Checking…"
              ) : slugProblem ? (
                <span className="text-error">{SLUG_REASONS[slugProblem] ?? "Not usable."}</span>
              ) : slug && verdict?.available ? (
                <span className="text-sage">“{slug}” is free.</span>
              ) : (
                "The old address redirects here for 90 days, and no other studio can take it meanwhile."
              )}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canContinue}>
              Continue
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}

/** One app's address, before and after. */
function AddressMove({ label, from, to }: { label: string; from: string | null; to: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="break-all text-muted line-through">{from ?? "—"}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted" />
        <span className="break-all font-medium text-ink">{to ?? "—"}</span>
      </div>
    </div>
  );
}
