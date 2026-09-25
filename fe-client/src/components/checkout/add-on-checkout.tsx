"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { addMonths, differenceInDays } from "date-fns";
import { AlertCircle } from "lucide-react";
import { getMemberToken } from "@/lib/member-auth";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CheckoutFrame, checkoutCardClass } from "./checkout-frame";
import { fetchApi } from "@/lib/api-url";
import { ERROR_CODES } from "@/lib/error-codes";
import { checkoutErrorMessage } from "@/lib/checkout-messages";
import { blockedByPayments, NO_ONLINE_PAYMENTS, useOnlinePayments } from "@/lib/online-payments";
import { useLocations } from "@/lib/classes";
import { useClientPackages, type LivePackage } from "@/lib/use-client-packages";
import { roundsUpAPartMonth } from "@/lib/add-on-months";
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
  if (!roundsUpAPartMonth(end, months, now)) {
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
  const getToken = getMemberToken;
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
        const res = await fetchApi("/me/checkout/cross-location/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ client_package_id: planId }),
        });
        const data = await res.json();
        if (dropped) return;
        if (!res.ok) {
          // The server refuses; the block states the refusal as a precondition
          // rather than inventing a verdict of its own.
          if (data.error === ERROR_CODES.cross_location_already_added) setReason("already_added");
          // Not theirs, not a plan, or no longer live — all of them are the
          // member having nothing to attach an Add-On to.
          else if (
            data.error === ERROR_CODES.client_package_not_found ||
            data.error === ERROR_CODES.cross_location_plan_not_live ||
            data.error === ERROR_CODES.cross_location_requires_unlimited
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
      const res = await fetchApi("/me/checkout/cross-location", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ client_package_id: planId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(checkoutErrorMessage(res.ok ? null : data, "Could not start checkout. Please try again."));
        setRedirecting(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Network error. Please try again.");
      setRedirecting(false);
    }
  }

  const onlinePayments = useOnlinePayments();
  const plan: LivePackage | null = packages.find((p) => p.id === planId) ?? null;
  const otherLocations = (locations ?? [])
    .filter((l) => l.id !== plan?.location?.id)
    .map((l) => l.name);
  // A Dormant plan has no end date to count back from: it prices at its full
  // stored Duration, so there is nothing to explain and no sentence to show.
  const remainder =
    quote && plan?.expiresAt ? remainderSentence(plan.expiresAt, quote.months) : null;

  if (packagesLoading || loadingQuote) {
    return (
      <CheckoutFrame>
        <div className="py-20 text-center text-muted text-sm" aria-busy="true">Loading…</div>
      </CheckoutFrame>
    );
  }

  return (
    <div id="checkout">
      <CheckoutFrame title="Checkout" description="Review your add-on, then pay securely.">
        <div className="space-y-5">

          <div className={checkoutCardClass}>
            <h2 className="text-sm font-semibold text-muted">Purchase summary</h2>
            {/* The page is entered with a plan's id, so name the plan the
                Add-On attaches to — the block says "expires with the plan it's
                attached to" without saying which one. */}
            {plan && <p className="text-xs text-muted mt-1">Attaching to {plan.name}</p>}

            {/* The Add-On IS the order here — one line, no plan beside it and
                nothing a Promo Code can discount — so the shared block is the
                whole summary. It already names the item, the rate, the months
                and the total; a second item row and a second total beside it
                were a copy of the review page's summary that could only drift
                from it (§494, #47). */}
            <CrossLocationBlock
              rateSgd={quote?.rate_sgd ?? crossLocation.rateSgd}
              months={quote?.months ?? 0}
              otherLocations={otherLocations}
              checked={Boolean(quote)}
              disabledReason={reason}
              remainder={remainder}
              totalSgd={quote?.price_sgd}
            />
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {quote && blockedByPayments(onlinePayments, quote.price_sgd) ? (
            // A studio that takes no online payments (#293): a sentence, not a Pay button.
            <p className="text-sm text-muted text-center">{NO_ONLINE_PAYMENTS}</p>
          ) : quote ? (
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
              className="flex w-full min-h-[48px] items-center justify-center rounded-full border border-ink/10 bg-card py-3.5 text-center text-sm font-medium text-ink hover:border-accent transition-colors"
            >
              Back to your account
            </Link>
          )}
        </div>
      </CheckoutFrame>
    </div>
  );
}
