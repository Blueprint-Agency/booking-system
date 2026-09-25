"use client";

import { useEffect, useState } from "react";
import { ShoppingBag, Store } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingSurface } from "@/components/booking/booking-surface";
import { BuyButton } from "@/components/checkout/buy-button";
import { CancelledBanner } from "@/components/checkout/cancelled-banner";
import { SectionHeading } from "@/components/booking/section-heading";
import { publicApi } from "@/lib/api";
import { formatSgd } from "@/lib/utils";

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
    <BookingSurface maxWidth="xl" flush>
      <SectionHeading eyebrow="Studio shop" title="Merch" />

      {/* Back from the payment page without paying (#274). */}
      <CancelledBanner className="mb-6" />

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-accent/20 bg-accent/5 px-4 py-3 text-sm text-ink">
        <Store className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <p>
          <span className="font-semibold">Pay online, collect at the studio.</span>{" "}
          We hand your item over at the front desk on your next visit — nothing is shipped.
        </p>
      </div>

      {!items && !error && (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          aria-label="Loading merch"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-80 rounded-2xl" />
          ))}
        </div>
      )}

      {error && (
        <div className="mx-auto max-w-md rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-center text-sm text-ink">
          We couldn&apos;t load merch right now. Please refresh in a moment.
        </div>
      )}

      {items && items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-ink/15 px-6 py-14 text-center">
          <ShoppingBag className="mx-auto h-6 w-6 text-muted" aria-hidden />
          <p className="mt-3 text-sm font-medium text-ink">Nothing in the shop just yet</p>
          <p className="mt-1 text-sm text-muted">Check back soon.</p>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 md:gap-6">
          {items.map((item) => (
            <article
              key={item.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-ink/5 bg-card shadow-soft"
            >
              {/* 4:3 on a phone so one item doesn't fill the whole screen. */}
              <div className="flex aspect-[4/3] items-center justify-center bg-warm sm:aspect-square">
                {item.image_url ? (
                  // Plain <img>: R2 hosts are not in next.config remotePatterns.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt={item.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ShoppingBag className="h-8 w-8 text-muted" />
                )}
              </div>
              <div className="flex flex-1 flex-col p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="min-w-0 font-serif text-lg leading-snug text-ink">{item.title}</h3>
                  <span className="whitespace-nowrap text-base font-bold text-ink">
                    {formatSgd(item.price_sgd)}
                  </span>
                </div>
                {item.description && (
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">
                    {item.description}
                  </p>
                )}
                <div className="mt-auto" />
                <BuyButton
                  target={{ kind: "merch", merchId: item.id }}
                  context="buy merch"
                  gateHref="/merch"
                  priceSgd={item.price_sgd}
                  className="mt-4 w-full min-h-[44px] rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-deep"
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
