"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { ReceiptStatusBadge } from "@/components/receipts/receipt-status-badge";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import { getPortalToken } from "@/lib/portal-auth";
import { formatDate } from "@/lib/formatters";
import { paymentLabel, receiptAmount, receiptKindLabel, type Receipt } from "@/lib/receipts";

/**
 * One Receipt (#389), exactly as the member sees it on their own account: the
 * same payload, and the same PDF. Everything on it is what the studio wrote
 * when the purchase was paid; nothing is worked out here, and nothing on it
 * can be edited.
 */
export default function AdminReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api } = useWorkspace();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [failure, setFailure] = useState<"missing" | "error" | null>(null);
  const [downloading, setDownloading] = useState(false);

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
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" disabled={downloading} onClick={() => void downloadPdf(receipt)}>
              <Download className="h-4 w-4" aria-hidden />
              {downloading ? "Preparing PDF…" : "Download PDF"}
            </Button>
          </div>

          <article
            aria-labelledby="receipt-heading"
            className="rounded-xl border border-border bg-card px-5 py-6 shadow-soft sm:px-8 sm:py-8"
          >
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Receipt</p>
                <h1 id="receipt-heading" className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-ink">
                  {receipt.number}
                </h1>
                <p className="mt-1 text-sm text-muted">
                  Issued {formatDate(receipt.issued_at, "d MMM yyyy")} · {receiptKindLabel(receipt.kind)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ReceiptStatusBadge status={receipt.status} />
                  {receipt.refunded_at && (
                    <span className="text-xs text-muted">Refunded on {formatDate(receipt.refunded_at, "d MMM yyyy")}</span>
                  )}
                </div>
              </div>
              <div className="text-right text-sm">
                <p className="font-semibold text-ink">{receipt.seller.name}</p>
                {receipt.seller.legal_name && <p className="text-muted">{receipt.seller.legal_name}</p>}
                {receipt.seller.registration_number && <p className="text-muted">{receipt.seller.registration_number}</p>}
                {receipt.seller.address && <p className="whitespace-pre-line text-muted">{receipt.seller.address}</p>}
              </div>
            </header>

            <section className="border-b border-border py-4 text-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Issued to</h2>
              {receipt.buyer.name || receipt.buyer.email ? (
                <>
                  {receipt.buyer.name && <p className="mt-1 font-medium text-ink">{receipt.buyer.name}</p>}
                  {receipt.buyer.email && <p className="text-muted">{receipt.buyer.email}</p>}
                </>
              ) : (
                <p className="mt-1 text-muted">A member since permanently deleted.</p>
              )}
            </section>

            <section aria-label="What was bought" className="border-b border-border py-4">
              <ul className="space-y-3">
                {receipt.lines.map((line, i) => (
                  <li key={i} className="text-sm">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-medium text-ink">
                        {line.description}
                        {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                      </span>
                      <span className="tabular-nums text-ink">{receiptAmount(line.amount_sgd)}</span>
                    </div>
                    {line.discounts.length > 0 && (
                      <div className="mt-1 space-y-0.5 text-xs text-muted">
                        <p className="tabular-nums">List price {receiptAmount(line.list_price_sgd)}</p>
                        {line.discounts.map((d, j) => (
                          <p key={j} className="tabular-nums">
                            {d.label} −{receiptAmount(d.amount_sgd)}
                          </p>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <dl className="space-y-1.5 border-b border-border py-4">
              <TotalRow label="Subtotal" value={receiptAmount(receipt.subtotal_sgd)} />
              {Number(receipt.discount_sgd) > 0 && (
                <TotalRow label="Discount" value={`−${receiptAmount(receipt.discount_sgd)}`} />
              )}
              <TotalRow label="Total paid" value={receiptAmount(receipt.total_sgd)} strong />
            </dl>

            <section className="py-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                {receipt.payments.length === 1 ? "Payment" : "Payments"}
              </h2>
              {receipt.payments.length === 0 ? (
                <p className="mt-1 text-sm text-muted">No payment: nothing was due.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {receipt.payments.map((p, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-4 text-sm">
                      <span className="text-ink">
                        {paymentLabel(p)} <span className="text-muted">· {formatDate(p.paid_at, "d MMM yyyy")}</span>
                      </span>
                      <span className="tabular-nums text-ink">{receiptAmount(p.amount_sgd)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {receipt.seller.footer && (
              <footer className="whitespace-pre-line border-t border-border pt-4 text-xs text-muted">
                {receipt.seller.footer}
              </footer>
            )}
          </article>
        </>
      )}
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${strong ? "text-base font-semibold text-ink" : "text-sm text-muted"}`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
