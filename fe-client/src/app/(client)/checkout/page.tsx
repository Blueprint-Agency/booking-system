"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { purchasePackage, signIn, isLoggedIn, useMockState, getPurchaseBlock, issueInvoice, recordBooking } from "@/lib/mock-state";
import { Lock, ShoppingCart, Tag, Check } from "lucide-react";
import { cn, formatCurrency, formatDate, formatTime } from "@/lib/utils";
import type { Session, Instructor } from "@/types";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";
import { BookingSurface } from "@/components/booking/booking-surface";
import { EmptyState } from "@/components/ui/empty-state";

// Mock referral codes: SADHANA20 = S$20 off, FRIEND10 = S$10 off
const REFERRAL_CODES: Record<string, number> = {
  SADHANA20: 20,
  FRIEND10: 10,
};

const allSessions = sessionsData as Session[];
const allInstructors = instructorsData as Instructor[];

// All purchasable packages — mirrors packages/page.tsx data
type PackageItem = { id: string; name: string; subtitle: string; price: number };

const PACKAGE_CATALOGUE: PackageItem[] = [
  { id: "b-otp",    name: "One-time Pass",             subtitle: "1 credit · valid 1 day",        price: 40 },
  { id: "b-10",     name: "Bundle of 10",               subtitle: "10 credits · valid 90 days",    price: 300 },
  { id: "b-20",     name: "Bundle of 20",               subtitle: "20 credits · valid 180 days",   price: 550 },
  { id: "b-30",     name: "Bundle of 30",               subtitle: "30 credits · valid 365 days",   price: 750 },
  { id: "b-50",     name: "Bundle of 50",               subtitle: "50 credits · valid 365 days",   price: 1100 },
  { id: "b-100",    name: "Bundle of 100",              subtitle: "100 credits · valid 365 days",  price: 2000 },
  { id: "u-3",      name: "3-Month Unlimited",          subtitle: "Unlimited classes · 3 months",  price: 600 },
  { id: "u-6",      name: "6-Month Unlimited",          subtitle: "Unlimited classes · 6 months",  price: 1000 },
  { id: "u-12",     name: "12-Month Unlimited",         subtitle: "Unlimited classes · 12 months", price: 1700 },
  { id: "p1-10",    name: "VIP 1-on-1 · 10 Sessions",  subtitle: "10 private sessions",           price: 1600 },
  { id: "p1-20",    name: "VIP 1-on-1 · 20 Sessions",  subtitle: "20 private sessions",           price: 3000 },
  { id: "p1-30",    name: "VIP 1-on-1 · 30 Sessions",  subtitle: "30 private sessions",           price: 4200 },
  { id: "p1-40",    name: "VIP 1-on-1 · 40 Sessions",  subtitle: "40 private sessions",           price: 5200 },
  { id: "p1-50",    name: "VIP 1-on-1 · 50 Sessions",  subtitle: "50 private sessions",           price: 6000 },
  { id: "p1-100",   name: "VIP 1-on-1 · 100 Sessions", subtitle: "100 private sessions",          price: 11000 },
  { id: "p2-10",    name: "VIP 2-on-1 · 10 Sessions",  subtitle: "10 private sessions",           price: 2000 },
  { id: "p2-20",    name: "VIP 2-on-1 · 20 Sessions",  subtitle: "20 private sessions",           price: 3600 },
  { id: "p2-30",    name: "VIP 2-on-1 · 30 Sessions",  subtitle: "30 private sessions",           price: 4800 },
  { id: "p2-50",    name: "VIP 2-on-1 · 50 Sessions",  subtitle: "50 private sessions",           price: 7500 },
];

type Step = 1 | 2 | 3;

const STEP_LABELS = ["Personal info", "Pay with", "Review"] as const;

const labelClass = "text-xs uppercase tracking-wider text-muted mb-2 block";
const inputClass =
  "rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none transition-colors";

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center justify-center gap-0">
      {([1, 2, 3] as Step[]).map((n, idx) => {
        const active = n === current;
        const done = n < current;
        return (
          <div key={n} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold",
                  active
                    ? "bg-ink text-paper"
                    : done
                    ? "bg-ink/20 text-ink"
                    : "bg-warm text-muted"
                )}
              >
                {n}
              </div>
              <span className="text-xs mt-2 text-muted whitespace-nowrap">
                {STEP_LABELS[idx]}
              </span>
            </div>
            {idx < 2 && (
              <div
                className={cn(
                  "h-px w-12 md:w-20 mx-2 mb-5",
                  n < current ? "bg-ink/30" : "bg-ink/10"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);

  // Form state
  const [firstName, setFirstName] = useState("Sarah");
  const [lastName, setLastName] = useState("Chen");
  const [email, setEmail] = useState("sarah.chen@email.com");
  const [phone, setPhone] = useState("+65 9123 4567");
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [expiry, setExpiry] = useState("12/28");
  const [cvc, setCvc] = useState("123");
  const [nameOnCard, setNameOnCard] = useState("Sarah Chen");
  const [referralInput, setReferralInput] = useState("");
  const [referralApplied, setReferralApplied] = useState<{ code: string; amount: number } | null>(null);
  const [referralError, setReferralError] = useState<string | null>(null);

  // Cart data source: URL params
  const packageId = searchParams.get("package");
  const sessionId = searchParams.get("session");
  const type = searchParams.get("type");

  // Resolve what's being purchased
  let orderName = "";
  let orderSubtitle = "";
  let orderExtra: string | null = null;
  let total = 0;
  let confirmUrl = "/booking/confirmation";

  if (type === "workshop" && sessionId) {
    const session = allSessions.find((s) => s.id === sessionId);
    const instructor = allInstructors.find((i) => i.id === session?.instructorId);
    if (session) {
      orderName = session.name;
      orderSubtitle = `${formatDate(session.date)} · ${formatTime(session.time)} · ${session.duration} min`;
      orderExtra = instructor ? `with ${instructor.name}` : null;
      total = session.price ?? 0;
      confirmUrl = `/booking/confirmation?type=workshop&session=${sessionId}`;
    }
  } else if (packageId) {
    const pkg = PACKAGE_CATALOGUE.find((p) => p.id === packageId);
    if (pkg) {
      orderName = pkg.name;
      orderSubtitle = pkg.subtitle;
      total = pkg.price;
      confirmUrl = `/booking/confirmation?type=package&package=${packageId}`;
    }
  }

  const hasCart = !!orderName;
  const mockState = useMockState();
  const purchaseBlock = packageId ? getPurchaseBlock(mockState, packageId) : { blocked: false };
  const discount = referralApplied ? Math.min(referralApplied.amount, total) : 0;
  const subtotal = total;
  const discounted = Math.max(subtotal - discount, 0);
  const tax = Math.round(discounted * 0.09 * 100) / 100;
  const grandTotal = discounted + tax;

  function applyReferral() {
    const code = referralInput.trim().toUpperCase();
    if (!code) return;
    const amount = REFERRAL_CODES[code];
    if (!amount) {
      setReferralError("Invalid referral code");
      setReferralApplied(null);
      return;
    }
    setReferralError(null);
    setReferralApplied({ code, amount });
  }

  if (!hasCart) {
    return (
      <BookingSurface maxWidth="lg" padding="default">
        <EmptyState
          icon={ShoppingCart}
          title="Your cart is empty"
          description="Pick a package or workshop to get started."
          cta={{ href: "/packages", label: "Browse packages" }}
        />
      </BookingSurface>
    );
  }

  if (purchaseBlock.blocked) {
    return (
      <BookingSurface maxWidth="lg" padding="default">
        <EmptyState
          icon={ShoppingCart}
          title="This package can't be purchased right now"
          description={purchaseBlock.reason ?? ""}
          cta={{ href: "/packages", label: "Back to packages" }}
        />
      </BookingSurface>
    );
  }

  function handlePay() {
    setLoading(true);
    if (!isLoggedIn()) signIn(email);
    if (packageId) {
      purchasePackage(packageId);
      issueInvoice({
        itemName: orderName,
        itemKind: "package",
        subtotal: discounted,
        referenceId: packageId,
      });
    } else if (type === "workshop" && sessionId) {
      issueInvoice({
        itemName: orderName,
        itemKind: "workshop",
        subtotal: discounted,
        referenceId: sessionId,
      });
      recordBooking({
        id: `YS-BOOKING-${sessionId.toUpperCase()}`,
        sessionId,
        type: "workshop",
        bookedAt: new Date().toISOString(),
      });
    }
    setTimeout(() => router.push(confirmUrl), 1500);
  }

  function handleContinue() {
    if (step < 3) setStep((s) => (s + 1) as Step);
    else handlePay();
  }

  function handleBack() {
    if (step > 1) setStep((s) => (s - 1) as Step);
  }

  if (!mockState.user) {
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
            You need an account before you can purchase a package or book a session. Log in, or create one in under a minute.
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5 justify-center">
            <a
              href={loginHref}
              className="flex-1 inline-flex items-center justify-center px-5 py-2.5 text-sm font-bold text-inverse bg-accent rounded-md hover:bg-accent-deep transition-colors"
            >
              Log in
            </a>
            <a
              href={registerHref}
              className="flex-1 inline-flex items-center justify-center px-5 py-2.5 text-sm font-bold text-ink border border-ink/15 rounded-md hover:bg-warm transition-colors"
            >
              Sign up
            </a>
          </div>
        </div>
      </BookingSurface>
    );
  }

  return (
    <>
<div id="form">
        <BookingSurface maxWidth="lg" padding="default">
          {/* Step indicator */}
          <StepIndicator current={step} />

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10 mt-10">
            {/* Left column — step fields */}
            <div className="lg:order-1 order-2">
              {step === 1 && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>First name</label>
                      <input
                        className={inputClass}
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="First name"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Last name</label>
                      <input
                        className={inputClass}
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="Last name"
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Email address</label>
                    <input
                      type="email"
                      className={inputClass}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@email.com"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Phone number</label>
                    <input
                      type="tel"
                      className={inputClass}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+65 9000 0000"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Referral code (optional)</label>
                    {referralApplied ? (
                      <div className="flex items-center justify-between rounded-xl border border-accent-deep/30 bg-accent/10 px-4 py-3 text-sm">
                        <span className="inline-flex items-center gap-2 text-ink">
                          <Check className="h-4 w-4 text-accent-deep" />
                          <span className="font-mono font-medium">{referralApplied.code}</span>
                          <span className="text-muted">— {formatCurrency(referralApplied.amount)} off</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setReferralApplied(null);
                            setReferralInput("");
                          }}
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
                              className={cn(inputClass, "pl-9 uppercase")}
                              value={referralInput}
                              onChange={(e) => {
                                setReferralInput(e.target.value);
                                if (referralError) setReferralError(null);
                              }}
                              placeholder="SADHANA20"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={applyReferral}
                            className="rounded-xl border border-ink/10 px-4 py-3 text-sm font-medium hover:border-accent transition-colors"
                          >
                            Apply
                          </button>
                        </div>
                        {referralError && (
                          <p className="text-xs text-red-600 mt-1.5">{referralError}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <label className={labelClass}>Card number</label>
                    <input
                      className={inputClass}
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      placeholder="1234 5678 9012 3456"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Expiry</label>
                      <input
                        className={inputClass}
                        value={expiry}
                        onChange={(e) => setExpiry(e.target.value)}
                        placeholder="MM/YY"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>CVC</label>
                      <input
                        className={inputClass}
                        value={cvc}
                        onChange={(e) => setCvc(e.target.value)}
                        placeholder="123"
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Name on card</label>
                    <input
                      className={inputClass}
                      value={nameOnCard}
                      onChange={(e) => setNameOnCard(e.target.value)}
                      placeholder="Full name"
                    />
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-muted pt-1">
                    <Lock className="h-3 w-3" />
                    Secured by Stripe
                  </p>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6">
                  <div>
                    <p className={labelClass}>Personal info</p>
                    <div className="rounded-xl border border-ink/10 bg-warm/40 px-4 py-3 text-sm text-ink space-y-1">
                      <p>{firstName} {lastName}</p>
                      <p className="text-muted">{email}</p>
                      <p className="text-muted">{phone}</p>
                    </div>
                  </div>
                  <div>
                    <p className={labelClass}>Payment</p>
                    <div className="rounded-xl border border-ink/10 bg-warm/40 px-4 py-3 text-sm text-ink space-y-1">
                      <p>•••• •••• •••• {cardNumber.slice(-4)}</p>
                      <p className="text-muted">Expires {expiry} · {nameOnCard}</p>
                    </div>
                  </div>
                  <div>
                    <p className={labelClass}>Order</p>
                    <div className="rounded-xl border border-ink/10 bg-warm/40 px-4 py-3 text-sm text-ink space-y-1">
                      <p className="font-medium">{orderName}</p>
                      <p className="text-muted">{orderSubtitle}</p>
                      {orderExtra && <p className="text-muted/70">{orderExtra}</p>}
                    </div>
                  </div>
                </div>
              )}

              {/* Step footer */}
              <div className="flex items-center justify-between mt-8 pt-6 border-t border-ink/10">
                {step > 1 ? (
                  <button
                    type="button"
                    onClick={handleBack}
                    className="rounded-full border border-ink/10 px-5 py-3 text-sm font-medium hover:border-accent transition-colors"
                  >
                    Back
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={handleContinue}
                  disabled={loading}
                  className={cn(
                    "rounded-full bg-ink text-paper px-6 py-3 text-sm font-medium transition-colors",
                    loading ? "opacity-60 cursor-not-allowed" : "hover:bg-ink/90"
                  )}
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Processing...
                    </span>
                  ) : step === 3 ? (
                    `Pay ${formatCurrency(grandTotal)}`
                  ) : (
                    "Continue"
                  )}
                </button>
              </div>
            </div>

            {/* Right column — sticky order summary */}
            <div className="order-1 lg:order-2 lg:sticky lg:top-24 self-start rounded-2xl border border-ink/10 bg-paper p-6">
              <p className="text-xs uppercase tracking-wider text-muted mb-4">Order summary</p>

              <div className="flex gap-3 items-start py-3 border-b border-ink/5 last:border-0">
                    <div className="h-12 w-12 rounded-lg bg-warm shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink">{orderName}</p>
                      <p className="text-xs text-muted mt-0.5">{orderSubtitle}</p>
                      {orderExtra && (
                        <p className="text-xs text-muted/70 mt-0.5">{orderExtra}</p>
                      )}
                    </div>
                    <p className="text-sm font-semibold shrink-0">{formatCurrency(subtotal)}</p>
                  </div>

                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between py-2 text-sm">
                      <span>Subtotal</span>
                      <span>{formatCurrency(subtotal)}</span>
                    </div>
                    {referralApplied && discount > 0 && (
                      <div className="flex justify-between py-2 text-sm text-accent-deep">
                        <span>Referral ({referralApplied.code})</span>
                        <span>−{formatCurrency(discount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between py-2 text-sm text-muted">
                      <span>GST (9%)</span>
                      <span>{formatCurrency(tax)}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-ink mt-2 pt-2 border-t border-ink/10">
                      <span>Total</span>
                      <span>{formatCurrency(grandTotal)}</span>
                    </div>
                  </div>

              <p className="text-xs text-muted mt-4">
                By completing your purchase you agree to our Terms of Service and Privacy Policy. All prices in SGD.
              </p>
            </div>
          </div>
        </BookingSurface>
      </div>
    </>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper px-4 py-12 text-muted text-sm">Loading...</div>}>
      <CheckoutContent />
    </Suspense>
  );
}
