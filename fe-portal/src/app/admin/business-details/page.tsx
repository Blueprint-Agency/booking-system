"use client";
import { LoadFailure } from "@/components/ui/load-failure";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Label, PageHeader, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import {
  RECEIPT_DETAIL_LIMITS,
  businessNameProblem,
  displayNameProblem,
  emptyReceiptDetailsDraft,
  getReceiptDetails,
  receiptDetailsDraft,
  receiptDetailsPayload,
  receiptNumberPreview,
  receiptPrefixProblem,
  saveReceiptDetails,
  type ReceiptDetailsDraft,
} from "@/lib/receipt-details";

/**
 * Business details: what the studio's business documents say
 * about it. The Business name it trades under, the registration number,
 * address and footer note its Receipts print, and the Receipt number prefix,
 * with a live preview of the number the next Receipt will take. Studio admins
 * only; the backend refuses instructors.
 */
export default function BusinessDetailsPage() {
  const { api } = useWorkspace();
  const [saved, setSaved] = useState<ReceiptDetailsDraft>(emptyReceiptDetailsDraft);
  const [draft, setDraft] = useState<ReceiptDetailsDraft>(emptyReceiptDetailsDraft);
  const [nextSequence, setNextSequence] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Bumped by Retry; loading until the attempt asked for has an answer.
  const [attempt, setAttempt] = useState(0);
  const [answered, setAnswered] = useState<number | null>(null);
  const loading = answered !== attempt;

  const show = useCallback((view: Awaited<ReturnType<typeof getReceiptDetails>>) => {
    const next = receiptDetailsDraft(view.business_details);
    setSaved(next);
    setDraft(next);
    setNextSequence(view.next_sequence);
  }, []);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    getReceiptDetails(api).then(
      (view) => {
        if (cancelled) return;
        show(view);
        setError(null);
        setAnswered(attempt);
      },
      (err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
        setAnswered(attempt);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, show, attempt]);

  const prefixError = receiptPrefixProblem(draft.prefix);
  const nameError = businessNameProblem(draft.business_name);
  const displayError = displayNameProblem(draft.display_name);
  const dirty = (Object.keys(draft) as Array<keyof ReceiptDetailsDraft>).some(
    (key) => draft[key] !== saved[key],
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!api || prefixError || nameError || displayError || !dirty) return;
    setSaving(true);
    try {
      show(await saveReceiptDetails(api, receiptDetailsPayload(draft)));
      toast.success("Business details saved. Receipts issued from now on carry them.");
    } catch (err) {
      // A refused save carries its own sentence ({ error, message }).
      toast.error(
        err instanceof ApiError
          ? ((err.body as { message?: string } | null)?.message ?? `Save failed (HTTP ${err.status}).`)
          : "Save failed.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading business details…
      </div>
    );
  }

  if (error) {
    return (
      <LoadFailure
        what="the business details"
        onRetry={() => setAttempt((n) => n + 1)}
        className="mx-auto max-w-3xl rounded-xl border border-border bg-card"
      />
    );
  }

  const field = (key: keyof ReceiptDetailsDraft) => ({
    value: draft[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft({ ...draft, [key]: e.target.value }),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Business details"
        description="What your studio’s Receipts say about your business. Changes apply to Receipts issued after you save; Receipts already issued keep what they were issued with."
      />

      <form onSubmit={handleSave} className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-6">
          <header className="mb-4">
            <h2 className="text-base font-semibold text-ink">Your business</h2>
            <p className="mt-0.5 text-xs text-muted">
              The Business name is the formal name your studio trades under, on its Receipts; the Display name
              is what members know it as. The rest are printed on Receipts; leave any you don’t need blank.
            </p>
          </header>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="business-name">Business name</Label>
              <Input
                id="business-name"
                {...field("business_name")}
                maxLength={RECEIPT_DETAIL_LIMITS.business_name}
                required
                aria-invalid={Boolean(nameError)}
                aria-describedby="business-name-help"
              />
              <p id="business-name-help" className="text-xs text-muted">
                {nameError ? (
                  <span className="text-error">{nameError}</span>
                ) : (
                  "Your formal name, shown as the seller on every Receipt."
                )}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                {...field("display_name")}
                maxLength={RECEIPT_DETAIL_LIMITS.display_name}
                required
                aria-invalid={Boolean(displayError)}
                aria-describedby="display-name-help"
              />
              <p id="display-name-help" className="text-xs text-muted">
                {displayError ? (
                  <span className="text-error">{displayError}</span>
                ) : (
                  "The everyday name members see in your apps and emails."
                )}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="receipt-registration">Registration number</Label>
              <Input
                id="receipt-registration"
                {...field("registration_number")}
                maxLength={RECEIPT_DETAIL_LIMITS.registration_number}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="receipt-address">Address</Label>
              <Textarea
                id="receipt-address"
                {...field("address")}
                rows={3}
                maxLength={RECEIPT_DETAIL_LIMITS.address}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="receipt-footer">Footer note</Label>
              <Textarea
                id="receipt-footer"
                {...field("footer")}
                rows={3}
                maxLength={RECEIPT_DETAIL_LIMITS.footer}
              />
              <p className="text-xs text-muted">Printed at the foot of every Receipt.</p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-6">
          <header className="mb-4">
            <h2 className="text-base font-semibold text-ink">Receipt number</h2>
            <p className="mt-0.5 text-xs text-muted">
              Every Receipt is numbered in order with no gaps. Changing the prefix does not restart the
              count.
            </p>
          </header>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="receipt-prefix">Prefix</Label>
              <Input
                id="receipt-prefix"
                {...field("prefix")}
                maxLength={10}
                aria-invalid={Boolean(prefixError)}
                aria-describedby="receipt-prefix-help"
              />
              <p id="receipt-prefix-help" className="text-xs text-muted">
                {prefixError ? <span className="text-error">{prefixError}</span> : "Letters and digits, up to 10."}
              </p>
            </div>
            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-ink">Next receipt</span>
              <p className="font-mono text-lg tabular-nums text-ink" aria-live="polite">
                {receiptNumberPreview(draft.prefix, nextSequence)}
              </p>
              <p className="text-xs text-muted">The number your next Receipt will take.</p>
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
            Reset
          </Button>
          <Button type="submit" disabled={!dirty || saving || Boolean(prefixError) || Boolean(nameError) || Boolean(displayError)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </Button>
        </div>
      </form>
    </div>
  );
}
