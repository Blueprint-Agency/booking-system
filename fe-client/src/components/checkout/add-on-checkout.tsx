"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { addMonths, differenceInDays } from "date-fns";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { formatCurrency, formatDate } from "@/lib/utils";
import { BookingSurface } from "@/components/booking/booking-surface";
import { getApiBaseUrl } from "@/lib/api-url";
import { useLocations } from "@/lib/classes";
import { useClientPackages, type LivePackage } from "@/lib/use-client-packages";
import { CrossLocationBlock, type AddOnDisabledReason } from "./cross-location-block";
import { PayButton, StripeFootnote } from "./pay-button";

/**
 * The part-months sentence, shown before the arithmetic so the surprising part
 * is answered before the number that provokes the question (§12). A commented
 * mirror of `crossLocationMonths` in `be/src/services/packages/validity.ts`: the
 * server's `months` is what is charged, and this only explains where it came from.
 */
function remainderSentence(expiresAt: string, months: number, now: Date = new Date()): string {
  const end = new Date(expiresAt);
  const runsTo = `Your plan runs to ${formatDate(expiresAt)}`;
  // Anchored on the server's `months` rather than on a second month count of
  // this app's own, so the breakdown can never contradict the number charged:
  // the server rounded up, so all but the last month is whole and the days are
  // what is left over on top of them.
  const exact = addMonths(now, months).getTime() === end.getTime();
  if (exact || months < 1) {
    return `${runsTo} — ${months} month${months === 1 ? "" : "s"} left.`;
  }
  const whole = months - 1;
  const days = Math.max(1, differenceInDays(end, addMonths(now, whole)));
  const left = [
    whole > 0 ? `${whole} month${whole === 1 ? "" : "s"}` : null,
    `${days} day${days === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(", ");
  return `${runsTo} — ${left} left. Part months are charged as whole months, so that's ${months}.`;
}

interface AddOnQuote {
  months: number;
  rate_sgd: string;
  price_sgd: string;
}

/**
 * The standalone Add-On purchase — the same review page entered with the target
 * plan's id, reached from the plan card and from the blocked-class nudge (§12).
 * There is no Home studio to pick and nothing a Promo Code can discount, so the
 * page carries the block, the arithmetic the server quoted, and Pay.
 */
export function AddOnCheckout({ planId }: { planId: string | null }) {
  const { getToken } = useAuth();
  const { packages, crossLocation, loading: packagesLoading } = useClientPackages();
  const { data: locations } = useLocations();
  const [quote, setQuote] = useState<AddOnQuote | null>(null);
  const [reason, setReason] = useState<AddOnDisabledReason | null>(planId ? null : "no_plan");
  const [loadingQuote, setLoadingQuote] = useState(Boolean(planId));
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!planId) return;
    let dropped = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${getApiBaseUrl()}/me/checkout/cross-location/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ client_package_id: planId }),
        });
        const data = await res.json();
        if (dropped) return;
        if (!res.ok) {
          // The server refuses; the block states the refusal as a precondition
          // rather than inventing a verdict of its own.
          if (data.error === "cross_location_already_added") setReason("already_added");
          // Not theirs, not a plan, or no longer live — all of them are the
          // member having nothing to attach an Add-On to.
          else if (
            data.error === "client_package_not_found" ||
            data.error === "cross_location_plan_not_live" ||
            data.error === "cross_location_requires_unlimited"
          )
            setReason("no_plan");
          else setError("We couldn't price the add-on. Please try again.");
          return;
        }
        setQuote(data as AddOnQuote);
      } catch {
        if (!dropped) setError("Network error. Please try again.");
      } finally {
        if (!dropped) setLoadingQuote(false);
      }
    })();
    return () => {
      dropped = true;
    };
  }, [planId, getToken]);

  async function handleProceed() {
    setRedirecting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${getApiBaseUrl()}/me/checkout/cross-location`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ client_package_id: planId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError("Could not start checkout. Please try again.");
        setRedirecting(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Network error. Please try again.");
      setRedirecting(false);
    }
  }

  const plan: LivePackage | null = packages.find((p) => p.id === planId) ?? null;
  const otherLocations = (locations ?? [])
    .filter((l) => l.id !== plan?.location?.id)
    .map((l) => l.name);
  // A Dormant plan has no end date to count back from: it prices at its full
  // stored Duration, so there is nothing to explain and no sentence to show.
  const remainder =
    quote && plan?.expiresAt ? remainderSentence(plan.expiresAt, quote.months) : null;
  // GST-inclusive, exactly as every other price on this page is.
  const totalCents = quote ? Math.round(Number(quote.price_sgd) * 100) : 0;
  const includedGst = (totalCents - Math.round(totalCents / 1.09)) / 100;

  if (packagesLoading || loadingQuote) {
    return (
      <BookingSurface maxWidth="lg" padding="default">
        <div className="py-20 text-center text-muted text-sm">Loading…</div>
      </BookingSurface>
    );
  }

  return (
    <div id="checkout">
      <BookingSurface maxWidth="lg" padding="default">
        <div className="max-w-lg mx-auto space-y-6">

          <div className="rounded-2xl border border-ink/10 bg-paper p-6">
            <p className="text-xs uppercase tracking-wider text-muted mb-4">Order summary</p>

            <div className="flex gap-3 items-start pb-4 border-b border-ink/5">
              <div className="h-12 w-12 rounded-lg bg-warm shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink">Cross-Location Add-On</p>
                <p className="text-xs text-muted mt-0.5">
                  {plan ? plan.name : "Attaches to an Unlimited plan"}
                </p>
              </div>
              {quote && (
                <p className="text-sm font-semibold shrink-0">
                  {formatCurrency(Number(quote.price_sgd))}
                </p>
              )}
            </div>

            <CrossLocationBlock
              rateSgd={quote?.rate_sgd ?? crossLocation.rateSgd}
              months={quote?.months ?? 0}
              otherLocations={otherLocations}
              checked={Boolean(quote)}
              disabledReason={reason}
              remainder={remainder}
            />

            {quote && (
              <div className="mt-4 space-y-1">
                <div className="flex justify-between py-1.5 text-sm text-muted">
                  <span>Includes GST (9%)</span>
                  <span>{formatCurrency(includedGst)}</span>
                </div>
                <div className="flex justify-between text-base font-bold text-ink mt-2 pt-2 border-t border-ink/10">
                  <span>Total</span>
                  <span>{formatCurrency(Number(quote.price_sgd))}</span>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {quote ? (
            <>
              <PayButton
                onClick={handleProceed}
                busy={redirecting}
                disabled={false}
                label={`Pay ${formatCurrency(Number(quote.price_sgd))} with Stripe`}
              />
              <StripeFootnote />
            </>
          ) : (
            <Link
              href="/account"
              className="block w-full rounded-full border border-ink/10 py-3.5 text-center text-sm font-medium text-ink hover:border-accent transition-colors"
            >
              Back to your account
            </Link>
          )}
        </div>
      </BookingSurface>
    </div>
  );
}
