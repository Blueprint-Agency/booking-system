"use client";

import { useEffect, useState } from "react";
import { Loader2, ShoppingBag, Store } from "lucide-react";
import { BookingSurface } from "@/components/booking/booking-surface";
import { BuyButton } from "@/components/checkout/buy-button";
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
    <BookingSurface maxWidth="xl" padding="default">
      <SectionHeading eyebrow="Studio shop" title="Merch" />

      <div className="mb-8 flex items-start gap-3 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 text-sm text-ink">
        <Store className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p>
          Merch is paid for online and collected in person — once you&apos;ve purchased an
          item, we&apos;ll hand it over to you physically at the studio. Nothing is shipped.
        </p>
      </div>

      {!items && !error && (
        <div className="flex items-center justify-center py-16 text-sm text-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading merch…
        </div>
      )}

      {error && (
        <div className="mx-auto max-w-md rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-center text-sm text-ink">
          We couldn&apos;t load merch right now. Please refresh in a moment.
        </div>
      )}

      {items && items.length === 0 && (
        <div className="py-20 text-center">
          <p className="text-muted">Nothing in the shop just yet. Check back soon.</p>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.id}
              className="overflow-hidden rounded-xl border border-border bg-card shadow-soft"
            >
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
                  <ShoppingBag className="h-8 w-8 text-muted" />
                )}
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-serif text-lg leading-snug text-ink">{item.title}</h3>
                  <span className="whitespace-nowrap text-sm font-semibold text-ink">
                    {formatSgd(item.price_sgd)}
                  </span>
                </div>
                {item.description && (
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">
                    {item.description}
                  </p>
                )}
                <BuyButton
                  target={{ kind: "merch", merchId: item.id }}
                  context="buy merch"
                  gateHref="/merch"
                  priceSgd={item.price_sgd}
                  className="mt-4 w-full rounded-full bg-accent px-5 py-2.5 text-xs font-medium text-white transition-colors hover:bg-accent-deep"
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
