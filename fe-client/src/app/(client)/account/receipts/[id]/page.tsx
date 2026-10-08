"use client";

/**
 * One Receipt — `GET /me/receipts/:id` (#384). Everything on it is what the
 * studio wrote when the purchase was paid: the studio, the member, the lines,
 * the totals and how it was paid. Nothing is worked out here.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ContentLoading } from "@/components/ui/content-loading";
import { CARD } from "@/components/ui/styles";
import { apiErrorCode, useApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { paymentLabel, receiptAmount, receiptStatusLabel, type Receipt } from "@/lib/receipts";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "text-base font-bold text-ink" : "text-sm text-muted"}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

export default function AccountReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [failure, setFailure] = useState<"missing" | "error" | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Receipt>(`/me/receipts/${id}`)
      .then((res) => !cancelled && setReceipt(res))
      .catch((err) => !cancelled && setFailure(apiErrorCode(err) === "receipt_not_found" ? "missing" : "error"));
    return () => {
      cancelled = true;
    };
    // The api client is rebuilt on every render; the fetch follows the id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="max-w-2xl">
      <Link
        href="/account/receipts"
        className="-ml-1 mb-2 inline-flex min-h-[36px] items-center gap-0.5 rounded-full pr-2 text-sm font-semibold text-accent-deep hover:text-accent"
      >
        <ChevronLeft className="h-4 w-4" />
        Receipts
      </Link>

      {!receipt && !failure && <ContentLoading label="Loading receipt" />}

      {failure && (
        <div role="alert" className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          {failure === "missing"
            ? "We couldn't find that receipt on your account."
            : "We couldn't load this receipt right now. Please refresh in a moment."}
        </div>
      )}

      {receipt && (
        <article aria-labelledby="receipt-heading" className={`${CARD} px-5 py-6 sm:px-8 sm:py-8`}>
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink/5 pb-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent-deep">Receipt</p>
              <h1 id="receipt-heading" className="mt-1 text-2xl font-extrabold tracking-tight text-ink tabular-nums">
                {receipt.number}
              </h1>
              <p className="mt-1 text-sm text-muted">Issued {formatDate(receipt.issued_at)}</p>
              {receipt.refunded_at && (
                <p className="mt-2 inline-flex rounded-full bg-error/10 px-3 py-1 text-xs font-semibold text-error">
                  Refunded on {formatDate(receipt.refunded_at)}
                </p>
              )}
            </div>
            <div className="text-right text-sm">
              <p className="font-semibold text-ink">{receipt.seller.name}</p>
              {receipt.seller.legal_name && <p className="text-muted">{receipt.seller.legal_name}</p>}
              {receipt.seller.registration_number && <p className="text-muted">{receipt.seller.registration_number}</p>}
              {receipt.seller.address && <p className="whitespace-pre-line text-muted">{receipt.seller.address}</p>}
            </div>
          </header>

          {(receipt.buyer.name || receipt.buyer.email) && (
            <section className="border-b border-ink/5 py-4 text-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Issued to</h2>
              {receipt.buyer.name && <p className="mt-1 font-semibold text-ink">{receipt.buyer.name}</p>}
              {receipt.buyer.email && <p className="text-muted">{receipt.buyer.email}</p>}
            </section>
          )}

          <section aria-label="What was bought" className="border-b border-ink/5 py-4">
            <ul className="space-y-3">
              {receipt.lines.map((line, i) => (
                <li key={i} className="text-sm">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-semibold text-ink">
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

          <dl className="space-y-1.5 border-b border-ink/5 py-4">
            <Row label="Subtotal" value={receiptAmount(receipt.subtotal_sgd)} />
            {Number(receipt.discount_sgd) > 0 && <Row label="Discount" value={`−${receiptAmount(receipt.discount_sgd)}`} />}
            <Row label="Total paid" value={receiptAmount(receipt.total_sgd)} strong />
          </dl>

          <section className="py-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              {receipt.payments.length === 1 ? "Payment" : "Payments"}
            </h2>
            {receipt.payments.length === 0 ? (
              <p className="mt-1 text-sm text-muted">Nothing to pay.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {receipt.payments.map((p, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="text-ink">
                      {paymentLabel(p)} <span className="text-muted">· {formatDate(p.paid_at)}</span>
                    </span>
                    <span className="tabular-nums text-ink">{receiptAmount(p.amount_sgd)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">Status: {receiptStatusLabel(receipt.status)}</p>
          </section>

          {receipt.seller.footer && (
            <footer className="border-t border-ink/5 pt-4 text-xs text-muted whitespace-pre-line">{receipt.seller.footer}</footer>
          )}
        </article>
      )}
    </div>
  );
}
