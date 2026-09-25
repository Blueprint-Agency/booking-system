"use client";

import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { ContentLoading } from "@/components/ui/content-loading";
import { EmptyState } from "@/components/ui/empty-state";
import { BTN_PRIMARY, CARD } from "@/components/ui/styles";
import { BookingSurface } from "@/components/booking/booking-surface";
import { PageHeader } from "@/components/booking/page-header";
import { BuyButton } from "@/components/checkout/buy-button";
import { CancelledBanner } from "@/components/checkout/cancelled-banner";
import { publicApi } from "@/lib/api";
import { cn, formatSgd } from "@/lib/utils";

interface ApiMerch {
  id: string;
  title: string;
  description: string | null;
  price_sgd: string;
  image_url: string | null;
}

export default function MerchPage() {
  const [items, setItems] = useState<ApiMerch[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    publicApi
      .get<{ merch: ApiMerch[] }>("/public/merch")
      .then((res) => !cancelled && setItems(res.merch))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <BookingSurface>
      {/* Nothing is shipped: the one thing a buyer must know before paying. */}
      <PageHeader title="Merch" description="Pay online, collect at the front desk on your next visit." />

      {/* Back from the payment page without paying (#274). */}
      <CancelledBanner className="mb-5" />

      {!items && !error && (
        <ContentLoading label="Loading merch" />
      )}

      {error && (
        <div className={cn(CARD, "p-8 text-center text-sm text-muted")}>
          Couldn&apos;t load merch. Refresh to try again.
        </div>
      )}

      {items && items.length === 0 && (
        <div className={CARD}>
          <EmptyState
            icon={ShoppingBag}
            title="Nothing in the shop yet"
            description="New items show up here when the studio adds them."
          />
        </div>
      )}

      {items && items.length > 0 && (
        // Two across on a phone: an item is a picture, a name and a price, and
        // one per screen made the shop a long scroll.
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 md:gap-6">
          {items.map((item) => (
            <article key={item.id} className={cn(CARD, "flex flex-col overflow-hidden")}>
              <div className="flex aspect-square items-center justify-center bg-warm">
                {item.image_url ? (
                  // Plain <img>: R2 hosts are not in next.config remotePatterns.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt={item.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ShoppingBag className="h-8 w-8 text-ink/20" aria-hidden />
                )}
              </div>
              <div className="flex flex-1 flex-col p-3 sm:p-5">
                <h2 className="font-semibold leading-snug text-ink break-words">{item.title}</h2>
                <p className="mt-0.5 text-sm font-bold text-ink">{formatSgd(item.price_sgd)}</p>
                {item.description && (
                  <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-muted sm:mt-2 sm:line-clamp-none sm:text-sm">
                    {item.description}
                  </p>
                )}
                <div className="mt-auto" />
                <BuyButton
                  target={{ kind: "merch", merchId: item.id }}
                  context="buy merch"
                  gateHref="/merch"
                  priceSgd={item.price_sgd}
                  className={cn(BTN_PRIMARY, "mt-3 sm:mt-4 w-full min-h-[44px]")}
                >
                  Buy
                </BuyButton>
              </div>
            </article>
          ))}
        </div>
      )}
    </BookingSurface>
  );
}
