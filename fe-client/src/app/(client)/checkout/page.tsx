"use client";

import { useState, Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, ShoppingCart, Tag, Check, AlertCircle, MapPin } from "lucide-react";
import { cn, formatCurrency, formatDurationMonths } from "@/lib/utils";
import { BookingSurface } from "@/components/booking/booking-surface";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@clerk/nextjs";
import { getApiBaseUrl } from "@/lib/api-url";
import { useLocations } from "@/lib/classes";
import { CrossLocationBlock } from "@/components/checkout/cross-location-block";
import { AddOnCheckout } from "@/components/checkout/add-on-checkout";
import { PayButton, StripeFootnote } from "@/components/checkout/pay-button";
import { useClientPackages } from "@/lib/use-client-packages";
import { tierEffectivePrice, type ApiWorkshopDetail, type ApiWorkshopTier } from "@/lib/workshops";
import type { ApiClassPackage, ApiPtPackage } from "@/lib/packages";

// Either catalogue entry the checkout can hold; both are snake_case wire shapes.
type PackageInfo =
  | ({ _kind: "class" } & ApiClassPackage)
  | ({ _kind: "pt" } & ApiPtPackage);

function subtitleForPackage(pkg: PackageInfo): string {
  if (pkg._kind === "pt") {
    return `${pkg.num_sessions} private sessions`;
  }
  if (pkg.kind === "credit_bundle" || pkg.kind === "trial") {
    const days = pkg.validity_days ?? 0;
    const validity = days === 1 ? "1 day" : `${days} days`;
    return `${pkg.credits} credit${pkg.credits === 1 ? "" : "s"} · valid ${validity}`;
  }
  const duration = pkg.duration_months != null ? formatDurationMonths(pkg.duration_months) : "?";
  return `Unlimited classes · ${duration}`;
}

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getToken, isSignedIn, isLoaded } = useAuth();

  const packageId = searchParams.get("package");
  const packageKind = (searchParams.get("kind") ?? "class") as "class" | "pt";
  const workshopId = searchParams.get("workshop");
  const tierId = searchParams.get("tier");
  const cancelled = searchParams.get("cancelled") === "1";
  // The standalone Add-On purchase is this same page, entered with the target
  // plan's id (§12). Entered without one — a member who holds no plan followed
  // the link anyway — the block states the precondition rather than 404ing.
  const isAddOnOnly = searchParams.has("add_on");
  const addOnPlanId = searchParams.get("add_on") || null;
  const mode: "package" | "workshop" | "add_on" = isAddOnOnly
    ? "add_on"
    : workshopId
      ? "workshop"
      : "package";

  const [pkg, setPkg] = useState<PackageInfo | null>(null);
  const [workshop, setWorkshop] = useState<ApiWorkshopDetail | null>(null);
  const [selectedTier, setSelectedTier] = useState<ApiWorkshopTier | null>(null);
  const [loadingPkg, setLoadingPkg] = useState(true);
  const [pkgError, setPkgError] = useState<string | null>(null);

  const [promoInput, setPromoInput] = useState("");
  const [promoApplied, setPromoApplied] = useState<{ code: string; discountSgd: number; label: string } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);

  const [redirecting, setRedirecting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Home studio (§12). Only an Unlimited Plan carries one; a member already
  // holding a live plan renews at that plan's Location and gets no choice.
  const [homeLocationId, setHomeLocationId] = useState<string | null>(null);
  const { data: locations, loading: locationsLoading } = useLocations();
  const { unlimitedLocation, crossLocation, loading: packagesLoading } = useClientPackages();
  // The Add-On taken with the plan (§5). A plan bought now has its whole
  // Duration ahead of it whether its clock starts today or it waits Dormant, so
  // it prices at the stored Duration with no remainder — a commented mirror of
  // `priceCrossLocationForNewPlan`, which is what the charge is actually built from.
  const [addOn, setAddOn] = useState(false);
  const isUnlimited = pkg?._kind === "class" && pkg.kind === "unlimited";
  const chosenLocation = isUnlimited
    ? unlimitedLocation ?? locations?.find((l) => l.id === homeLocationId) ?? null
    : null;
  const needsHomeStudio = isUnlimited && !unlimitedLocation && !homeLocationId;

  // Fetch package or workshop details from the catalogue
  useEffect(() => {
    if (mode === "workshop") {
      if (!workshopId) { setLoadingPkg(false); return; }
      fetch(`${getApiBaseUrl()}/public/workshops/${workshopId}`)
        .then(r => r.json())
        .then((data: ApiWorkshopDetail) => {
          if (!data?.id) { setPkgError("Workshop not found."); return; }
          setWorkshop(data);
          const fallback = data.tiers[0] ?? null;
          const chosen = tierId ? data.tiers.find(t => t.id === tierId) ?? fallback : fallback;
          if (!chosen) { setPkgError("Workshop has no tiers available."); return; }
          setSelectedTier(chosen);
        })
        .catch(() => setPkgError("Could not load workshop details."))
        .finally(() => setLoadingPkg(false));
      return;
    }
    if (!packageId) {
      setLoadingPkg(false);
      return;
    }
    fetch(`${getApiBaseUrl()}/public/packages`)
      .then(r => r.json())
      .then((data: { class_packages?: ApiClassPackage[]; pt_packages?: ApiPtPackage[] }) => {
        const found: PackageInfo | undefined =
          packageKind === "class"
            ? data.class_packages
                ?.filter((p) => p.id === packageId)
                .map((p) => ({ _kind: "class" as const, ...p }))[0]
            : data.pt_packages
                ?.filter((p) => p.id === packageId)
                .map((p) => ({ _kind: "pt" as const, ...p }))[0];
        if (!found) setPkgError("Package not found.");
        else setPkg(found);
      })
      .catch(() => setPkgError("Could not load package details."))
      .finally(() => setLoadingPkg(false));
  }, [mode, packageId, packageKind, workshopId, tierId]);

  async function applyPromo() {
    const code = promoInput.trim();
    if (!code) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      // /me/* routes require the Clerk token — without it the BE 401s and the
      // promo would always read as invalid.
      const token = await getToken();
      const res = await fetch(`${getApiBaseUrl()}/me/checkout/validate-promo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        // The product travels with the code — the server cannot answer the
        // scope case without it, and a green tick it would contradict seconds
        // later at checkout is worse than no tick.
        body: JSON.stringify({
          code,
          ...(mode === "workshop"
            ? { workshop_id: workshopId, workshop_tier_id: selectedTier?.id }
            : { package_kind: packageKind, package_id: packageId }),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        // Four of the five reasons are specific; the server writes the sentence
        // and this never derives one. Unknown and archived share theirs.
        setPromoError(data.message ?? "Could not validate code. Try again.");
        setPromoApplied(null);
      } else {
        setPromoApplied({
          code: data.code,
          discountSgd: Number(data.discount_sgd),
          label: data.label,
        });
      }
    } catch {
      setPromoError("Could not validate code. Try again.");
    } finally {
      setPromoLoading(false);
    }
  }

  async function handleProceed() {
    setRedirecting(true);
    setCheckoutError(null);
    try {
      const token = await getToken();
      const endpoint = mode === "workshop" ? "/me/checkout/workshop" : "/me/checkout/package";
      const body = mode === "workshop"
        ? { workshop_id: workshopId, workshop_tier_id: selectedTier?.id, promo_code: promoApplied?.code }
        : {
            package_kind: packageKind,
            package_id: packageId,
            promo_code: promoApplied?.code,
            location_id: chosenLocation?.id,
            cross_location_add_on: isUnlimited && addOn,
          };
      const res = await fetch(`${getApiBaseUrl()}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        // The server refuses a bad code rather than charging full price. Drop
        // the code from the screen at the same time, so the interface can never
        // show it accepted while the purchase was refused for it.
        if (data.error === "promo_code_invalid") {
          setPromoApplied(null);
          setPromoError(data.message ?? "That code can't be used on this purchase.");
        } else {
          setCheckoutError(data.error ?? "Could not start checkout. Please try again.");
        }
        setRedirecting(false);
        return;
      }
      // Free path: BE returned an immediate grant (free trial package, or free workshop).
      if (data.outcome === "granted") {
        if (mode === "workshop" && data.booking_id) {
          router.push(`/booking/confirmation?type=workshop&workshop_id=${workshopId}&booking_id=${data.booking_id}`);
        } else if (mode === "package" && data.client_package_id) {
          router.push(`/booking/confirmation?type=package&package_id=${packageId}&package_kind=${packageKind}`);
        } else {
          router.push(`/account`);
        }
        return;
      }
      if (!data.url) {
        setCheckoutError("Could not start checkout. Please try again.");
        setRedirecting(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setCheckoutError("Network error. Please try again.");
      setRedirecting(false);
    }
  }

  if (!isLoaded || loadingPkg) {
    return (
      <BookingSurface maxWidth="lg" padding="default">
        <div className="py-20 text-center text-muted text-sm">Loading…</div>
      </BookingSurface>
    );
  }

  const hasItem =
    mode === "add_on"
      ? true
      : mode === "workshop"
        ? Boolean(workshop && selectedTier)
        : Boolean(pkg);
  if (pkgError || !hasItem) {
    return (
      <BookingSurface maxWidth="lg" padding="default">
        <EmptyState
          icon={ShoppingCart}
          title="Your cart is empty"
          description={pkgError ?? "Pick a package or workshop to get started."}
          cta={{ href: mode === "workshop" ? "/workshops" : "/packages", label: mode === "workshop" ? "Browse workshops" : "Browse packages" }}
        />
      </BookingSurface>
    );
  }

  if (isLoaded && !isSignedIn) {
    const next = typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : "/checkout";
    const loginHref = `/login?next=${encodeURIComponent(next)}`;
    const registerHref = `/register?next=${encodeURIComponent(next)}`;
    return (
      <BookingSurface maxWidth="md" padding="default">
        <div className="max-w-md mx-auto text-center py-12">
          <div className="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-5">
            <Lock className="w-6 h-6 text-accent-deep" />
          </div>
          <h1 className="text-2xl font-serif text-ink mb-2">Please log in to continue</h1>
          <p className="text-sm text-muted mb-6 leading-relaxed">
            You need an account before you can purchase a package. Log in, or create one in under a minute.
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5 justify-center">
            <a href={loginHref} className="flex-1 inline-flex items-center justify-center px-5 py-2.5 text-sm font-bold text-inverse bg-accent rounded-md hover:bg-accent-deep transition-colors">
              Log in
            </a>
            <a href={registerHref} className="flex-1 inline-flex items-center justify-center px-5 py-2.5 text-sm font-bold text-ink border border-ink/15 rounded-md hover:bg-warm transition-colors">
              Sign up
            </a>
          </div>
        </div>
      </BookingSurface>
    );
  }

  // Same page, different item: an Add-On bought against a plan already held has
  // no catalogue entry, no Home studio to pick and nothing a Promo Code can
  // discount (§5), so it renders its own body below the shared gates.
  if (mode === "add_on") return <AddOnCheckout planId={addOnPlanId} />;

  const itemName = mode === "workshop"
    ? `${workshop!.name} — ${selectedTier!.name}`
    : pkg!.name;
  const subtitle = mode === "workshop"
    ? (selectedTier!.description ?? `${selectedTier!.day_ids.length} session${selectedTier!.day_ids.length === 1 ? "" : "s"} included`)
    : subtitleForPackage(pkg!);
  // Catalogue prices are GST-inclusive — the total charged IS the (post-promo)
  // listed price; GST is the portion embedded within it, not added on top. Mirrors
  // the BE charge math exactly (be/src/routes/client/purchases.ts) so the shown
  // total equals the Stripe charge.
  const baseCents = Math.round(
    parseFloat(
      mode === "workshop" ? tierEffectivePrice(selectedTier!).amount : pkg!.effective_price_sgd,
    ) * 100,
  );
  const discountCents = promoApplied
    ? Math.min(Math.round(promoApplied.discountSgd * 100), baseCents)
    : 0;
  const addOnMonths = pkg?._kind === "class" ? pkg.duration_months ?? 0 : 0;
  // A commented mirror of `crossLocationPriceSgd`, so the breakdown adds up to
  // what the server will charge. The server still prices the session.
  const addOnCents =
    isUnlimited && addOn ? Math.round(Number(crossLocation.rateSgd) * 100) * addOnMonths : 0;
  // The Add-On is its own money beside the plan's, never folded into it — a
  // Promo Code discounts the plan line only (§5).
  const totalCents = baseCents - discountCents + addOnCents;
  const price = baseCents / 100;
  const discount = discountCents / 100;
  const includedGst = (totalCents - Math.round(totalCents / 1.09)) / 100;
  const grandTotal = totalCents / 100;

  return (
    <div id="checkout">
      <BookingSurface maxWidth="lg" padding="default">
        <div className="max-w-lg mx-auto space-y-6">

          {cancelled && (
            <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
              <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <span>Payment was cancelled. You can try again below.</span>
            </div>
          )}

          {/* Order summary card */}
          <div className="rounded-2xl border border-ink/10 bg-paper p-6">
            <p className="text-xs uppercase tracking-wider text-muted mb-4">Order summary</p>

            <div className="flex gap-3 items-start pb-4 border-b border-ink/5">
              <div className="h-12 w-12 rounded-lg bg-warm shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink">{itemName}</p>
                <p className="text-xs text-muted mt-0.5">{subtitle}</p>
              </div>
              <p className="text-sm font-semibold shrink-0">{formatCurrency(price)}</p>
            </div>

            {/* Home studio — an Unlimited Plan covers one Location, chosen here. */}
            {isUnlimited && (
              <div className="mt-4 pb-4 border-b border-ink/5">
                <p className="text-sm font-medium text-ink mb-1">Home studio</p>
                {packagesLoading || locationsLoading ? (
                  <p className="text-xs text-muted py-3">Loading…</p>
                ) : unlimitedLocation ? (
                  <div className="flex items-start gap-2.5 rounded-xl border border-ink/10 bg-warm px-4 py-3">
                    <Lock className="h-4 w-4 text-muted shrink-0 mt-0.5" />
                    <p className="text-sm text-ink">
                      Your renewal continues at{" "}
                      <span className="font-medium">{unlimitedLocation.name}</span>. Ask us if you
                      need to move it.
                    </p>
                  </div>
                ) : !locations?.length ? (
                  // useLocations swallows a failed fetch into an empty list. Without
                  // this, Pay sits disabled above a picker with nothing to click.
                  <p className="text-sm text-error py-2">
                    We couldn&apos;t load the studios. Refresh the page and try again.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted mb-3">
                      This plan covers one studio. Pick the one you&apos;ll practise at.
                    </p>
                    <div className="space-y-2">
                      {locations.map((loc) => (
                        <label
                          key={loc.id}
                          className={cn(
                            "flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors",
                            homeLocationId === loc.id
                              ? "border-accent-deep bg-accent/10"
                              : "border-ink/10 hover:border-accent",
                          )}
                        >
                          <input
                            type="radio"
                            name="home-studio"
                            value={loc.id}
                            checked={homeLocationId === loc.id}
                            onChange={() => setHomeLocationId(loc.id)}
                            className="mt-0.5 h-4 w-4 border-ink/30 text-accent focus:ring-accent"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-ink">{loc.name}</span>
                            {loc.address && (
                              <span className="mt-0.5 flex items-start gap-1 text-xs text-muted">
                                <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                                {loc.address}
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Cross-Location Add-On — disabled until a studio is picked (§12).
                Held back until the rate has loaded, so it never quotes S$0. */}
            {isUnlimited && !packagesLoading && (
              <CrossLocationBlock
                rateSgd={crossLocation.rateSgd}
                months={addOnMonths}
                otherLocations={(locations ?? [])
                  .filter((l) => l.id !== chosenLocation?.id)
                  .map((l) => l.name)}
                checked={addOn}
                onChange={setAddOn}
                disabledReason={chosenLocation ? null : "no_home_location"}
              />
            )}

            {/* Promo code */}
            <div className="mt-4">
              {promoApplied ? (
                <div className="flex items-center justify-between rounded-xl border border-accent-deep/30 bg-accent/10 px-4 py-3 text-sm">
                  <span className="inline-flex items-center gap-2 text-ink">
                    <Check className="h-4 w-4 text-accent-deep" />
                    <span className="font-mono font-medium">{promoApplied.code}</span>
                    <span className="text-muted">— {formatCurrency(promoApplied.discountSgd)} off</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => { setPromoApplied(null); setPromoInput(""); }}
                    className="text-xs text-muted hover:text-ink underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                      <input
                        type="text"
                        value={promoInput}
                        onChange={(e) => { setPromoInput(e.target.value); if (promoError) setPromoError(null); }}
                        onKeyDown={(e) => e.key === "Enter" && applyPromo()}
                        placeholder="Promo code"
                        className="rounded-xl border border-ink/10 bg-paper pl-9 pr-4 py-3 text-sm w-full uppercase focus:border-accent focus:outline-none transition-colors"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={applyPromo}
                      disabled={promoLoading || !promoInput.trim()}
                      className="rounded-xl border border-ink/10 px-4 py-3 text-sm font-medium hover:border-accent transition-colors disabled:opacity-50"
                    >
                      Apply
                    </button>
                  </div>
                  {promoError && <p className="text-xs text-error mt-1.5">{promoError}</p>}
                </>
              )}
            </div>

            {/* Price breakdown */}
            <div className="mt-4 space-y-1">
              <div className="flex justify-between py-1.5 text-sm">
                <span>Subtotal</span>
                <span>{formatCurrency(price)}</span>
              </div>
              {promoApplied && discount > 0 && (
                <div className="flex justify-between py-1.5 text-sm text-accent-deep">
                  <span>Promo ({promoApplied.code})</span>
                  <span>−{formatCurrency(discount)}</span>
                </div>
              )}
              {addOnCents > 0 && (
                <div className="flex justify-between py-1.5 text-sm">
                  <span>Cross-Location Add-On</span>
                  <span>{formatCurrency(addOnCents / 100)}</span>
                </div>
              )}
              <div className="flex justify-between py-1.5 text-sm text-muted">
                <span>Includes GST (9%)</span>
                <span>{formatCurrency(includedGst)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-ink mt-2 pt-2 border-t border-ink/10">
                <span>Total</span>
                <span>{formatCurrency(grandTotal)}</span>
              </div>
            </div>
          </div>

          {checkoutError && (
            <div className="flex items-start gap-3 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{checkoutError}</span>
            </div>
          )}

          {/* The choice restated, so the member passes it twice before paying. */}
          {chosenLocation && (
            <p className="text-sm text-ink text-center">
              Your home studio is{" "}
              <span className="font-medium">{chosenLocation.name}</span>
              {pkg?._kind === "class" && pkg.duration_months != null
                ? // A renewal waits for the running plan to end, so "the next N
                  // months" would name a stretch of time that hasn't started.
                  unlimitedLocation
                  ? ` for the ${formatDurationMonths(pkg.duration_months)} of this plan.`
                  : ` for the next ${formatDurationMonths(pkg.duration_months)}.`
                : "."}
            </p>
          )}

          <PayButton
            onClick={handleProceed}
            busy={redirecting}
            disabled={needsHomeStudio}
            label={
              needsHomeStudio
                ? "Choose your home studio to continue"
                : // A discount that clears the total skips Stripe entirely, so the
                  // button names the confirmation rather than a charge of nothing.
                  totalCents === 0
                  ? "Confirm your free purchase"
                  : `Pay ${formatCurrency(grandTotal)} with Stripe`
            }
          />

          {totalCents > 0 && <StripeFootnote />}
        </div>
      </BookingSurface>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper px-4 py-12 text-muted text-sm">Loading…</div>}>
      <CheckoutContent />
    </Suspense>
  );
}
