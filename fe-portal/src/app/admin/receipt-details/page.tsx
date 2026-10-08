"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Label, PageHeader, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import {
  RECEIPT_DETAIL_LIMITS,
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
 * Receipt details (#391): the studio's settings for what its Receipts carry.
 * The number prefix, with a live preview of the number the next Receipt will
 * take, and the business details printed under the studio's name and at the
 * foot. Studio admins only; the backend refuses instructors.
 */
export default function ReceiptDetailsPage() {
  const { api } = useWorkspace();
  const [saved, setSaved] = useState<ReceiptDetailsDraft>(emptyReceiptDetailsDraft);
  const [draft, setDraft] = useState<ReceiptDetailsDraft>(emptyReceiptDetailsDraft);
  const [nextSequence, setNextSequence] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const show = useCallback((view: Awaited<ReturnType<typeof getReceiptDetails>>) => {
    const next = receiptDetailsDraft(view.receipt_details);
    setSaved(next);
    setDraft(next);
    setNextSequence(view.next_sequence);
  }, []);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      show(await getReceiptDetails(api));
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api, show]);

  useEffect(() => {
    void load();
  }, [load]);

  const prefixError = receiptPrefixProblem(draft.prefix);
  const dirty = (Object.keys(draft) as Array<keyof ReceiptDetailsDraft>).some(
    (key) => draft[key] !== saved[key],
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!api || prefixError || !dirty) return;
    setSaving(true);
    try {
      show(await saveReceiptDetails(api, receiptDetailsPayload(draft)));
      toast.success("Receipt details saved. Receipts issued from now on carry them.");
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
        <Loader2 className="h-4 w-4 animate-spin" /> Loading receipt details…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-error/30 bg-error/5 p-6 text-center">
        <p className="text-sm text-error">Failed to load: {error}</p>
        <Button size="sm" variant="ghost" onClick={load} className="mt-2">
          Retry
        </Button>
      </div>
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
        title="Receipt details"
        description="What your studio’s Receipts carry. Changes apply to Receipts issued after you save; Receipts already issued keep what they were issued with."
      />

      <form onSubmit={handleSave} className="space-y-6">
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

        <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-6">
          <header className="mb-4">
            <h2 className="text-base font-semibold text-ink">Business details</h2>
            <p className="mt-0.5 text-xs text-muted">
              Printed under your studio’s name. Leave any you don’t need blank.
            </p>
          </header>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="receipt-legal-name">Legal name</Label>
              <Input id="receipt-legal-name" {...field("legal_name")} maxLength={RECEIPT_DETAIL_LIMITS.legal_name} />
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

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
            Reset
          </Button>
          <Button type="submit" disabled={!dirty || saving || Boolean(prefixError)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </Button>
        </div>
      </form>
    </div>
  );
}
