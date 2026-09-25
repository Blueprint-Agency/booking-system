"use client";

/**
 * Purchase history for merch — `GET /me/merch-orders`. Read-only: the item is
 * handed over at the studio, so there is nothing to self-serve here.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, ShoppingBag } from "lucide-react";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
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
      <AccountPageHeader
        title="Your merch"
        description="Nothing is shipped — collect your items at the front desk on your next visit."
        action={
          rows && rows.length > 0 ? (
            <Link
              href="/merch"
              className="inline-flex items-center gap-0.5 text-sm font-semibold text-accent-deep hover:text-accent"
            >
              Shop
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : undefined
        }
      />

      {!rows && !error && (
        <div className="rounded-2xl bg-card border border-ink/5 shadow-soft p-3 space-y-2" aria-busy="true" aria-label="Loading purchases">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          We couldn&apos;t load your purchases right now. Please refresh in a moment.
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="rounded-2xl bg-card border border-ink/5 shadow-soft">
          <EmptyState
            icon={ShoppingBag}
            title="No merch yet"
            description="Anything you buy from the studio shop shows up here."
            cta={{ href: "/merch", label: "Browse merch" }}
          />
        </div>
      )}

      {rows && rows.length > 0 && (
        <ul className="divide-y divide-ink/5 rounded-2xl border border-ink/5 bg-card shadow-soft">
          {rows.map((order) => (
            <li key={order.id} className="flex items-center gap-3 px-4 py-3 sm:px-5 sm:py-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/8 text-accent-deep">
                <ShoppingBag className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{order.title}</p>
                <p className="text-xs text-muted">Bought {formatDate(order.purchased_at)}</p>
              </div>
              <span className="whitespace-nowrap text-sm font-bold text-ink tabular-nums">
                {formatSgd(order.amount_sgd)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
