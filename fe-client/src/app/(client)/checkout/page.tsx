"use client";

import { useState, Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, ShoppingCart, Tag, Check, AlertCircle } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { BookingSurface } from "@/components/booking/booking-surface";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@clerk/nextjs";
import { getApiBaseUrl } from "@/lib/api-url";
import { tierEffectivePrice, type ApiWorkshopDetail, type ApiWorkshopTier } from "@/lib/workshops";

interface PackageInfo {
  id: string;
  name: string;
  kind: "credit_bundle" | "unlimited";
  credits: number | null;
  validityDays: number | null;
  durationDays: number | null;
  priceSgd: string;
  sessionType?: "1on1" | "2on1";
  numSessions?: number;
}

function subtitleForPackage(pkg: PackageInfo, kind: "class" | "pt"): string {
  if (kind === "pt") {
    return `${pkg.numSessions} private sessions`;
  }
  if (pkg.kind === "credit_bundle") {
    const days = pkg.validityDays ?? 0;
    const validity = days === 1 ? "1 day" : days >= 365 ? "365 days" : `${days} days`;
    return `${pkg.credits} credit${pkg.credits === 1 ? "" : "s"} · valid ${validity}`;
  }
  const months = pkg.durationDays != null ? Math.round(pkg.durationDays / 30) : "?";
  return `Unlimited classes · ${months} months`;
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
  const mode: "package" | "workshop" = workshopId ? "workshop" : "package";

  const [pkg, setPkg] = useState<PackageInfo | null>(null);
  const [workshop, setWorkshop] = useState<ApiWorkshopDetail | null>(null);
  const [selectedTier, setSelectedTier] = useState<ApiWorkshopTier | null>(null);
  const [loadingPkg, setLoadingPkg] = useState(true);
  const [pkgError, setPkgError] = useState<string | null>(null);

  const [promoInput, setPromoInput] = useState("");
  const [promoApplied, setPromoApplied] = useState<{ code: string; discountSgd: number; description: string } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);

  const [redirecting, setRedirecting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

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
      .then((data: { classPackages: PackageInfo[]; ptPackages: (PackageInfo & { sessionType: string; numSessions: number })[] }) => {
        let found: PackageInfo | undefined;
        if (packageKind === "class") {
          found = data.classPackages?.find((p: PackageInfo) => p.id === packageId);
        } else {
          found = data.ptPackages?.find((p: PackageInfo) => p.id === packageId) as PackageInfo | undefined;
        }
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
      const res = await fetch(`${getApiBaseUrl()}/me/checkout/validate-promo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!data.valid) {
        setPromoError("Invalid promo code");
        setPromoApplied(null);
      } else {
        setPromoApplied({ code: code.toUpperCase(), discountSgd: data.discountSgd, description: data.description });
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
        : { package_kind: packageKind, package_id: packageId, promo_code: promoApplied?.code };
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
        setCheckoutError(data.error ?? "Could not start checkout. Please try again.");
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

  const hasItem = mode === "workshop" ? Boolean(workshop && selectedTier) : Boolean(pkg);
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

  const itemName = mode === "workshop"
    ? `${workshop!.name} — ${selectedTier!.name}`
    : pkg!.name;
  const subtitle = mode === "workshop"
    ? (selectedTier!.description ?? `${selectedTier!.day_ids.length} session${selectedTier!.day_ids.length === 1 ? "" : "s"} included`)
    : subtitleForPackage(pkg!, packageKind);
  const price = mode === "workshop"
    ? parseFloat(tierEffectivePrice(selectedTier!).amount)
    : parseFloat(pkg!.priceSgd);
  const discount = promoApplied ? Math.min(promoApplied.discountSgd, price) : 0;
  const discountedBase = price - discount;
  const tax = Math.round(discountedBase * 0.09 * 100) / 100;
  const grandTotal = discountedBase + tax;

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
                  {promoError && <p className="text-xs text-red-600 mt-1.5">{promoError}</p>}
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
              <div className="flex justify-between py-1.5 text-sm text-muted">
                <span>GST (9%)</span>
                <span>{formatCurrency(tax)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-ink mt-2 pt-2 border-t border-ink/10">
                <span>Total</span>
                <span>{formatCurrency(grandTotal)}</span>
              </div>
            </div>
          </div>

          {checkoutError && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{checkoutError}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleProceed}
            disabled={redirecting}
            className={cn(
              "w-full rounded-full bg-ink text-paper py-4 text-sm font-semibold transition-colors",
              redirecting ? "opacity-60 cursor-not-allowed" : "hover:bg-ink/90"
            )}
          >
            {redirecting ? (
              <span className="inline-flex items-center gap-2 justify-center">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Redirecting to payment…
              </span>
            ) : (
              `Pay ${formatCurrency(grandTotal)} with Stripe`
            )}
          </button>

          <p className="text-xs text-muted text-center flex items-center justify-center gap-1.5">
            <Lock className="h-3 w-3" />
            Secured by Stripe · All prices in SGD
          </p>
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
