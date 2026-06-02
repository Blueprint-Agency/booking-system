"use client";

import { useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { useAuthGate } from "@/components/auth/auth-gate";
import { cn } from "@/lib/utils";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { useApi } from "@/lib/api";
import { formatSgd } from "@/lib/packages";
import {
  ApiCorporatePackage,
  corporateContactWhatsappHref,
  purchaseCorporate,
  useCorporatePackages,
} from "@/lib/corporate";

export default function CorporatePage() {
  const { data, loading, error } = useCorporatePackages();
  const active = (data ?? []).filter((p) => p.status === "active");

  return (
    <div id="corporate">
      <BookingSurface maxWidth="xl" padding="default">
        <SectionHeading
          eyebrow="For your team"
          title="Corporate yoga packages"
        />

        <p className="text-sm text-muted text-center max-w-xl mx-auto -mt-2 mb-8">
          Bring mindful movement to your workplace. Request a package below — we
          arrange the dates, location and instructor with you over WhatsApp.
        </p>

        {loading && (
          <div className="flex items-center justify-center py-16 text-muted text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading packages…
          </div>
        )}

        {!loading && error && (
          <div className="mx-auto max-w-md rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center">
            We couldn&apos;t load corporate packages right now. Please refresh in
            a moment.
          </div>
        )}

        {!loading && !error && (
          <>
            {active.length === 0 ? (
              <div className="mx-auto max-w-md text-center py-8 text-muted text-sm">
                No corporate packages are available right now.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {active.map((p) => (
                  <CorporateCard key={p.id} pkg={p} />
                ))}
              </div>
            )}

            <div className="mt-10 flex flex-col items-center gap-2 text-center">
              <a
                href={corporateContactWhatsappHref()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-ink/15 px-5 py-3 text-sm font-medium text-ink hover:bg-warm transition-colors"
              >
                <MessageCircle className="h-4 w-4" strokeWidth={1.5} />
                Contact us on WhatsApp
              </a>
              <p className="text-xs text-muted">
                Questions first? Chat with us before you buy.
              </p>
            </div>
          </>
        )}
      </BookingSurface>
    </div>
  );
}

function CorporateCard({ pkg }: { pkg: ApiCorporatePackage }) {
  const { isSignedIn } = useUser();
  const { requireAuth, gate } = useAuthGate("buy a package");
  const api = useApi();
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState(false);

  async function startCheckout() {
    setPending(true);
    setErr(false);
    try {
      const { url } = await purchaseCorporate(api, pkg.id);
      window.location.href = url;
    } catch {
      setErr(true);
      setPending(false);
    }
  }

  return (
    <div className="relative rounded-2xl bg-paper border border-ink/10 p-8 flex flex-col hover:shadow-hover hover:-translate-y-0.5 transition-all">
      <div>
        <p className="text-base font-medium text-ink">{pkg.name}</p>
        {pkg.description && (
          <p className="text-sm text-muted mt-2 leading-relaxed">
            {pkg.description}
          </p>
        )}
      </div>
      <div className="flex items-baseline gap-2 mt-4">
        <p className="text-2xl font-bold">{formatSgd(pkg.price_sgd)}</p>
      </div>
      <div className="mt-6 flex-1" />
      {err && (
        <p className="text-xs text-error mb-2">
          Couldn&apos;t start checkout. Please try again.
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!isSignedIn) {
            requireAuth("/corporate");
            return;
          }
          if (!pending) void startCheckout();
        }}
        className={cn(
          "rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 w-full text-center transition-colors inline-flex items-center justify-center gap-2",
          pending && "opacity-70 cursor-wait",
        )}
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pending ? "Redirecting…" : "Request this package"}
      </button>
      {gate}
    </div>
  );
}
