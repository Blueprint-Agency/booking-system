"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button, EmptyState, PageHeader, Pagination, usePaged } from "@/components/ui";
import { RefundDialog } from "@/components/clients/refund-dialog";
import { useWorkspace } from "@/lib/workspace-context";
import { runsStudio } from "@/lib/staff-role";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/formatters";

/**
 * Purchases a member part-paid and never came back to (#95).
 *
 * Money the studio is holding against nothing granted — no plan, no credits, no
 * place — that nobody has touched for a long time. It is a list and a button and
 * nothing else: **nothing is swept**, because money moving back to a member
 * without a person choosing it is not an improvement on money sitting still.
 *
 * Refund is the only exit offered here, deliberately. A studio that would rather
 * keep the money and be generous grants a comp package, which is a different
 * action on the member's own page.
 */
interface ApiSilentPurchase {
  id: string;
  kind: string;
  item_name: string;
  client_id: string;
  client_name: string;
  client_email: string;
  total_sgd: string;
  paid_sgd: string;
  outstanding_sgd: string;
  part_paid_at: string | null;
  last_payment_at: string;
  days_silent: number;
  /** The backend's own sentence. The portal derives no domain rule. */
  silence_notice: string;
  payment_count: number;
  created_at: string;
  grants_nothing: boolean;
}

export default function UnfinishedPurchasesPage() {
  const { api, role } = useWorkspace();
  // The same gate the member detail page puts on its Refund buttons — the role
  // split this was written against (superadmin) no longer exists.
  const canRefund = runsStudio(role);

  const [rows, setRows] = useState<ApiSilentPurchase[]>([]);
  const [silentAfterDays, setSilentAfterDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refundFor, setRefundFor] = useState<ApiSilentPurchase | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{
        purchases: ApiSilentPurchase[];
        silent_after_days: number;
      }>("/portal/admin/purchases/silent");
      setRows(res.purchases);
      setSilentAfterDays(res.silent_after_days);
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // Count and held total cover every row, not just the page on screen.
  const heldTotal = rows.reduce((sum, r) => sum + Number(r.paid_sgd), 0);
  const { visible, pagination } = usePaged(rows);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Unfinished purchases"
        description="Customers who paid part of a purchase and never came back. The studio is holding their money against nothing they received."
      />

      <div className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-xs text-muted">
        Listed after{" "}
        {silentAfterDays === null ? "a long silence" : `${silentAfterDays} days with no payment`}.
        Nothing is refunded automatically — every one of these is somebody&apos;s decision.
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading unfinished purchases…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-soft">
          <EmptyState
            icon={Wallet}
            title="Nothing has gone quiet"
            description="Every part-paid purchase has either been finished or is still recent."
          />
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between text-xs text-muted">
            <span>
              {rows.length} {rows.length === 1 ? "purchase" : "purchases"}
            </span>
            <span>
              Holding <span className="font-medium text-ink">S${heldTotal.toFixed(2)}</span>
            </span>
          </div>

          <div className="space-y-3">
            {visible.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-warning/40 bg-warning/5 px-5 py-4 shadow-soft"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{p.item_name}</p>
                    <p className="mt-1 text-xs text-muted">
                      <Link
                        href={`/admin/customers/${p.client_id}`}
                        className="underline underline-offset-2 hover:text-ink"
                      >
                        {p.client_name}
                      </Link>{" "}
                      · started {formatDate(p.created_at)}
                    </p>
                    <p className="mt-1 text-xs text-muted">{p.silence_notice}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-semibold text-ink">S${p.paid_sgd}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted">
                      Held · S${p.outstanding_sgd} unpaid
                    </p>
                  </div>
                </div>

                <p className="mt-3 flex items-start gap-1.5 text-xs text-ink">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                  <span>
                    Grants nothing — no plan, no credits, no place held. Do not check this
                    customer in against it.
                  </span>
                </p>

                {canRefund && (
                  <div className="mt-3 flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRefundFor(p)}
                      className="text-error hover:bg-error/10 hover:text-error"
                    >
                      Refund S${p.paid_sgd}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* The rows are standalone cards, so the pager is a card of its own. */}
          <Pagination
            {...pagination}
            noun="purchases"
            className="rounded-xl border border-border bg-card shadow-soft"
          />
        </>
      )}

      {canRefund && refundFor && (
        <RefundDialog
          packageName={refundFor.item_name}
          kind="unfinished"
          notice={null}
          paymentCount={refundFor.payment_count}
          onConfirm={async (reason) => {
            const purchaseId = refundFor.id;
            try {
              const res = await api!.post<{ returned_line: string }>(
                `/portal/admin/purchases/${purchaseId}/refund`,
                { reason },
              );
              // The backend's own sentence — "2 payments returned, totalling
              // S$120.00". One press of the button becomes one return per
              // payment, and that count is what the statement will show.
              toast.success(
                `${res.returned_line}. The purchase closes once the provider confirms.`,
              );
              setRefundFor(null);
              await load();
            } catch (err) {
              toast.error(
                err instanceof ApiError ? `Refund failed (HTTP ${err.status}).` : "Refund failed.",
              );
            }
          }}
          onClose={() => setRefundFor(null)}
        />
      )}
    </div>
  );
}
