"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useAuthGate } from "@/components/auth/auth-gate";
import { fetchApi } from "@/lib/api-url";
import { cn } from "@/lib/utils";
import { reportError } from "@/lib/report-error";

type BuyTarget =
  | { kind: "package"; packageKind: "class" | "pt"; packageId: string }
  | { kind: "workshop"; workshopId: string; tierId: string | null }
  | { kind: "merch"; merchId: string };

type AuthGateContext = "buy a package" | "book a workshop" | "buy merch";

/**
 * Purchase button. Gates on auth, then branches on the effective price:
 * above zero it pushes to the /checkout review page (order summary, Promo
 * Code, Pay); at zero it POSTs straight to the checkout endpoint, which the
 * BE grants immediately (free trial / free workshop / a package a Promotion
 * drives to $0) and lands on the confirmation page.
 *
 * `gateHref` is where the login modal sends the user to come back after
 * signing in (the original page they were on).
 */
export function BuyButton({
  target,
  context,
  gateHref,
  priceSgd,
  requiresReview = false,
  className,
  children,
  loadingLabel = "Redirecting…",
}: {
  target: BuyTarget;
  context: AuthGateContext;
  gateHref: string;
  /** Effective price — what the member actually pays. Decides the branch. */
  priceSgd: string | number;
  /**
   * The purchase needs a choice only the review page can take — an Unlimited
   * Plan's Home studio. The price no longer decides: a Promotion that drives the
   * plan to $0 would otherwise post straight to the grant with no Location and be
   * refused, leaving a free plan nobody can buy.
   */
  requiresReview?: boolean;
  className?: string;
  children: React.ReactNode;
  loadingLabel?: string;
}) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { isSignedIn } = useUser();
  const { requireAuth, gate } = useAuthGate(context);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const endpoint = `/me/checkout/${target.kind}`;
      const body =
        target.kind === "workshop"
          ? { workshop_id: target.workshopId, workshop_tier_id: target.tierId }
          : target.kind === "merch"
            ? { merch_id: target.merchId }
            : { package_kind: target.packageKind, package_id: target.packageId };

      const res = await fetchApi(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        reportError(new Error(`checkout ${res.status}`), {
          scope: "checkout",
          endpoint,
          status: res.status,
          body: data,
        });
        setError(data.error ?? "Could not start checkout. Please try again.");
        setBusy(false);
        return;
      }

      // Free path — BE granted immediately (free trial package / free workshop).
      if (data.outcome === "granted") {
        if (target.kind === "workshop" && data.booking_id) {
          router.push(
            `/booking/confirmation?type=workshop&workshop_id=${target.workshopId}&booking_id=${data.booking_id}`,
          );
        } else if (target.kind === "merch") {
          router.push("/booking/confirmation?type=merch");
        } else if (target.kind === "package" && data.client_package_id) {
          router.push(
            `/booking/confirmation?type=package&package_id=${target.packageId}&package_kind=${target.packageKind}`,
          );
        } else {
          router.push("/account");
        }
        return;
      }

      if (!data.url) {
        setError("Could not start checkout. Please try again.");
        setBusy(false);
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      reportError(err, { scope: "checkout", kind: target.kind });
      setError("Network error. Please try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!isSignedIn) {
            requireAuth(gateHref);
            return;
          }
          if (busy) return;
          // Merch has no order-summary page to review: one item, no Promo Code,
          // no choices — straight to the provider (or straight to the order, if
          // the studio priced it at zero).
          // A NaN price reads as paid on purpose — bad catalogue data must never
          // grant something for free.
          if (target.kind !== "merch" && (requiresReview || !(Number(priceSgd) <= 0))) {
            setBusy(true);
            router.push(
              target.kind === "workshop"
                ? `/checkout?workshop=${target.workshopId}${target.tierId ? `&tier=${target.tierId}` : ""}`
                : `/checkout?package=${target.packageId}&kind=${target.packageKind}`,
            );
            return;
          }
          void start();
        }}
        className={cn(
          className,
          busy && "opacity-70 cursor-wait",
          "inline-flex items-center justify-center gap-2",
        )}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy ? loadingLabel : children}
      </button>
      {error && (
        <p className="text-xs text-error mt-2 text-center">{error}</p>
      )}
      {gate}
    </>
  );
}
