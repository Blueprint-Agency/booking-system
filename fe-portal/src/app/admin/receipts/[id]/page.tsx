"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Download, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, DialogFooter } from "@/components/ui";
import { ReceiptDocument } from "@/components/receipts/receipt-document";
import { ReceiptStatusBadge } from "@/components/receipts/receipt-status-badge";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import { getPortalToken } from "@/lib/portal-auth";
import { receiptKindLabel, resendRefusal, type Receipt } from "@/lib/receipts";

/**
 * One Receipt (#389), exactly as the member sees it on their own account: the
 * same payload, the same PDF, and the Receipt itself framed from the same
 * `html` the backend draws for the member's page and the email, so the two
 * pages cannot show it differently. Everything on it is what the studio wrote
 * when the purchase was paid; nothing is worked out here, and nothing on it
 * can be edited. Resend (#390) sends it again, after a confirmation step, in
 * the email the purchase sent, to the member's current address.
 */
export default function AdminReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api } = useWorkspace();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [failure, setFailure] = useState<"missing" | "error" | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [confirmingResend, setConfirmingResend] = useState(false);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    api
      .get<Receipt>(`/portal/admin/receipts/${id}`)
      .then((res) => !cancelled && setReceipt(res))
      .catch((err) => {
        if (cancelled) return;
        const code = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
        setFailure(code === "receipt_not_found" ? "missing" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  // The PDF is behind the staff session, so it is fetched with it rather than linked to.
  const downloadPdf = async (of: Receipt) => {
    setDownloading(true);
    try {
      await downloadFile(getPortalToken, `/portal/admin/receipts/${of.id}/pdf`, {
        fallbackName: `${of.number}.pdf`,
        failure: "The receipt could not be downloaded.",
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "The receipt could not be downloaded.");
    } finally {
      setDownloading(false);
    }
  };

  // The purchase's own email again, with the Receipt and its PDF, to the
  // member's current address (#390). The dialog stays open on a refusal.
  const resend = async (of: Receipt) => {
    if (!api) return;
    try {
      const sent = await api.post<{ sent_to: string }>(`/portal/admin/receipts/${of.id}/resend`);
      toast.success(`Receipt ${of.number} sent to ${sent.sent_to}`);
      setConfirmingResend(false);
    } catch (err) {
      toast.error(resendRefusal(err instanceof ApiError ? err.body : null));
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/admin/receipts"
        className="-ml-1 mb-3 inline-flex min-h-9 items-center gap-0.5 rounded-md pr-2 text-sm font-medium text-muted hover:text-ink"
      >
        <ChevronLeft className="h-4 w-4" />
        Receipts
      </Link>

      {!receipt && !failure && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading receipt…
        </div>
      )}

      {failure && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-error">
          {failure === "missing"
            ? "There is no such receipt at this studio."
            : "The receipt could not be loaded. Refresh in a moment."}
        </div>
      )}

      {receipt && (
        <>
          <h1 className="sr-only">Receipt {receipt.number}</h1>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            {/* What the studio's staff need beside the member's own view of it. */}
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <ReceiptStatusBadge status={receipt.status} />
              <span>{receiptKindLabel(receipt.kind)}</span>
              {!receipt.buyer.name && !receipt.buyer.email && <span>· A member since permanently deleted</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={downloading} onClick={() => void downloadPdf(receipt)}>
                <Download className="h-4 w-4" aria-hidden />
                {downloading ? "Preparing PDF…" : "Download PDF"}
              </Button>
              {/* A permanently deleted member's Receipt names no one, and has no one to go to. */}
              {(receipt.buyer.name || receipt.buyer.email) && (
                <Button variant="secondary" onClick={() => setConfirmingResend(true)}>
                  <Send className="h-4 w-4" aria-hidden />
                  Resend
                </Button>
              )}
            </div>
          </div>

          {confirmingResend && (
            <ResendDialog
              number={receipt.number}
              onClose={() => setConfirmingResend(false)}
              onConfirm={() => resend(receipt)}
            />
          )}

          <ReceiptDocument html={receipt.html} title={`Receipt ${receipt.number}`} />
        </>
      )}
    </div>
  );
}

/** The confirmation step before a resend: what goes, and to whom. */
function ResendDialog({
  number,
  onClose,
  onConfirm,
}: {
  number: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={`Resend receipt ${number}?`}
      description="The member gets the email their purchase sent, with this receipt and its PDF, at the email address they have now. The resend is recorded under your name."
    >
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          {busy ? "Sending…" : "Send receipt"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
