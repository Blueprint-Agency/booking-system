"use client";

/**
 * Purchase history for merch — `GET /me/merch-orders`. Read-only: the item is
 * handed over at the studio, so there is nothing to self-serve here.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShoppingBag } from "lucide-react";
import { SectionHeading } from "@/components/booking/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { useApi } from "@/lib/api";
import { formatDate, formatSgd } from "@/lib/utils";

interface ApiMerchOrder {
  id: string;
  merch_id: string | null;
  title: string;
  amount_sgd: string;
  purchased_at: string;
}

export default function AccountMerchPage() {
  const api = useApi();
  const [rows, setRows] = useState<ApiMerchOrder[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ orders: ApiMerchOrder[] }>("/me/merch-orders")
      .then((res) => !cancelled && setRows(res.orders ?? []))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
    // The api client is rebuilt on every render; the fetch runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <SectionHeading eyebrow="Purchase history" title="My Merch" />

      <div className="mb-6 rounded-xl border border-ink/10 bg-card px-4 py-3 text-sm text-muted">
        Collect your merch at the studio — ask at the front desk on your next visit.
        Nothing is shipped.
      </div>

      {!rows && !error && (
        <div className="flex items-center justify-center py-16 text-sm text-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading purchases…
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          We couldn&apos;t load your purchases right now. Please refresh in a moment.
        </div>
      )}

      {rows && rows.length === 0 && (
        <EmptyState
          icon={ShoppingBag}
          title="No merch yet"
          description="Anything you buy from the studio shop shows up here."
          cta={{ href: "/merch", label: "Browse merch" }}
        />
      )}

      {rows && rows.length > 0 && (
        <ul className="divide-y divide-ink/10 rounded-2xl border border-ink/5 bg-card">
          {rows.map((order) => (
            <li key={order.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{order.title}</p>
                <p className="text-xs text-muted">
                  Purchased {formatDate(order.purchased_at)} · collect at the studio
                </p>
              </div>
              <span className="whitespace-nowrap text-sm font-semibold text-ink">
                {formatSgd(order.amount_sgd)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {rows && rows.length > 0 && (
        <Link
          href="/merch"
          className="mt-6 inline-block text-sm text-accent hover:underline"
        >
          Browse merch
        </Link>
      )}
    </div>
  );
}
