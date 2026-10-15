"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, DialogFooter, Input, Label, Textarea } from "@/components/ui";
import { ApiError, type Api } from "@/lib/api";
import type { PlatformTenant } from "@/lib/platform";
import {
  RECEIPT_DETAIL_LIMITS,
  businessNameProblem,
  displayNameProblem,
  getStudioReceiptDetails,
  receiptDetailsDraft,
  receiptDetailsPayload,
  receiptNumberPreview,
  receiptPrefixProblem,
  saveStudioReceiptDetails,
  type ReceiptDetailsDraft,
} from "@/lib/receipt-details";

/**
 * A studio's Business details (#391, #398), corrected by the operator from
 * outside it: the Business name it trades under on its Receipts and emails, and
 * what its Receipts print beside it. The same fields and rules as the studio's
 * own Business details page; a save reaches only Receipts issued afterwards.
 */
export interface BusinessDetailsDialogProps {
  api: Api;
  tenant: PlatformTenant | null;
  onOpenChange: (open: boolean) => void;
}

export function BusinessDetailsDialog({ api, tenant, onOpenChange }: BusinessDetailsDialogProps) {
  // The parent keys this component on the studio, so each opening reads that
  // studio's details afresh.
  const [saved, setSaved] = useState<ReceiptDetailsDraft | null>(null);
  const [draft, setDraft] = useState<ReceiptDetailsDraft | null>(null);
  const [nextSequence, setNextSequence] = useState(1);
  const [failed, setFailed] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Bumped by Retry, which asks again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    getStudioReceiptDetails(api, tenant.id).then(
      (view) => {
        if (cancelled) return;
        const loaded = receiptDetailsDraft(view.business_details);
        setSaved(loaded);
        setDraft(loaded);
        setNextSequence(view.next_sequence);
        setFailed(null);
      },
      (err) => {
        if (!cancelled) setFailed(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, tenant, attempt]);

  const nameError = draft ? businessNameProblem(draft.business_name) : null;
  const prefixError = draft ? receiptPrefixProblem(draft.prefix) : null;
  const displayError = draft ? displayNameProblem(draft.display_name) : null;
  const dirty =
    draft !== null &&
    saved !== null &&
    (Object.keys(draft) as Array<keyof ReceiptDetailsDraft>).some((key) => draft[key] !== saved[key]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!tenant || !draft || !dirty || nameError || displayError || prefixError) return;
    setSubmitting(true);
    try {
      await saveStudioReceiptDetails(api, tenant.id, receiptDetailsPayload(draft));
      toast.success(`${tenant.name}’s Business details saved. Receipts and emails from now on carry them.`);
      onOpenChange(false);
    } catch (err) {
      // A refused save carries its own sentence ({ error, message }).
      toast.error(
        err instanceof ApiError
          ? ((err.body as { message?: string } | null)?.message ?? `Save failed (HTTP ${err.status}).`)
          : "Save failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const field = (key: keyof ReceiptDetailsDraft) => ({
    value: draft?.[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft((d) => (d ? { ...d, [key]: e.target.value } : d)),
  });

  return (
    <Dialog
      open={Boolean(tenant)}
      onOpenChange={onOpenChange}
      title="Business details"
      description={
        tenant
          ? `What ${tenant.name}’s Receipts and emails say about its business. Receipts already issued keep what they were issued with.`
          : ""
      }
    >
      {failed ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-error">Could not load the Business details: {failed}.</p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setFailed(null);
                setAttempt((n) => n + 1);
              }}
            >
              Retry
            </Button>
          </DialogFooter>
        </div>
      ) : !draft ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bd-business-name">Business name</Label>
            <Input
              id="bd-business-name"
              {...field("business_name")}
              maxLength={RECEIPT_DETAIL_LIMITS.business_name}
              required
              aria-invalid={Boolean(nameError)}
              aria-describedby="bd-business-name-help"
            />
            <p id="bd-business-name-help" className="text-xs text-muted">
              {nameError ? (
                <span className="text-error">{nameError}</span>
              ) : (
                "The formal name the studio trades under: the seller on its Receipts."
              )}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bd-display-name">Display name</Label>
            <Input
              id="bd-display-name"
              {...field("display_name")}
              maxLength={RECEIPT_DETAIL_LIMITS.display_name}
              required
              aria-invalid={Boolean(displayError)}
              aria-describedby="bd-display-name-help"
            />
            <p id="bd-display-name-help" className="text-xs text-muted">
              {displayError ? (
                <span className="text-error">{displayError}</span>
              ) : (
                "The everyday name members see in the studio’s apps and emails."
              )}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bd-registration">Registration number</Label>
            <Input
              id="bd-registration"
              {...field("registration_number")}
              maxLength={RECEIPT_DETAIL_LIMITS.registration_number}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bd-address">Address</Label>
            <Textarea id="bd-address" {...field("address")} rows={3} maxLength={RECEIPT_DETAIL_LIMITS.address} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bd-footer">Footer note</Label>
            <Textarea id="bd-footer" {...field("footer")} rows={2} maxLength={RECEIPT_DETAIL_LIMITS.footer} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bd-prefix">Receipt number prefix</Label>
            <Input
              id="bd-prefix"
              {...field("prefix")}
              maxLength={10}
              aria-invalid={Boolean(prefixError)}
              aria-describedby="bd-prefix-help"
            />
            <p id="bd-prefix-help" className="text-xs text-muted">
              {prefixError ? (
                <span className="text-error">{prefixError}</span>
              ) : (
                `The next Receipt is ${receiptNumberPreview(draft.prefix, nextSequence)}. Changing the prefix does not restart the count.`
              )}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!dirty || submitting || Boolean(nameError) || Boolean(displayError) || Boolean(prefixError)}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}
