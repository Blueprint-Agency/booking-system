"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import { motion } from "framer-motion";
import { cn, formatCurrency, formatDate, formatTime } from "@/lib/utils";
import type { Session, Instructor } from "@/types";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";

const allSessions = sessionsData as Session[];
const allInstructors = instructorsData as Instructor[];

const inputClass =
  "w-full bg-warm border border-border rounded-md px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-accent/30 focus:border-accent outline-none transition placeholder:text-muted";

// All purchasable packages — mirrors packages/page.tsx data
type PackageItem = { id: string; name: string; subtitle: string; price: number };

const PACKAGE_CATALOGUE: PackageItem[] = [
  { id: "b-otp",    name: "One-time Pass",             subtitle: "1 credit · valid 1 day",        price: 40 },
  { id: "b-10",     name: "Bundle of 10",               subtitle: "10 credits · valid 90 days",    price: 300 },
  { id: "b-20",     name: "Bundle of 20",               subtitle: "20 credits · valid 180 days",   price: 550 },
  { id: "b-30",     name: "Bundle of 30",               subtitle: "30 credits · valid 365 days",   price: 750 },
  { id: "b-50",     name: "Bundle of 50",               subtitle: "50 credits · valid 365 days",   price: 1100 },
  { id: "b-100",    name: "Bundle of 100",              subtitle: "100 credits · valid 365 days",  price: 2000 },
  { id: "b-travel", name: "Travel Package",             subtitle: "5 credits · valid 30 days",     price: 60 },
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

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);

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

  // Fallback if nothing resolved
  if (!orderName) {
    orderName = "Bundle of 10";
    orderSubtitle = "10 credits · valid 90 days";
    total = 300;
    confirmUrl = "/booking/confirmation?type=package&package=b-10";
  }

  function handlePay() {
    setLoading(true);
    setTimeout(() => router.push(confirmUrl), 1500);
  }

  return (
    <div className="min-h-screen bg-paper px-4 py-12 sm:py-20">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mx-auto max-w-4xl"
      >
        <h1 className="font-serif text-3xl text-ink mb-8">Checkout</h1>

        <div className="grid gap-8 lg:grid-cols-5">
          {/* Order Summary */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="lg:col-span-2"
          >
            <div className="rounded-lg border border-border bg-card p-6 shadow-soft">
              <h2 className="font-serif text-xl text-ink mb-5">Order Summary</h2>

              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-ink">{orderName}</p>
                    <p className="text-xs text-muted mt-0.5">{orderSubtitle}</p>
                    {orderExtra && (
                      <p className="text-xs text-muted/70 mt-1">{orderExtra}</p>
                    )}
                  </div>
                  <p className="text-sm font-medium text-ink whitespace-nowrap">
                    {formatCurrency(total)}
                  </p>
                </div>
              </div>

              <div className="my-5 border-t border-border" />

              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Total</p>
                <p className="text-lg font-semibold text-ink">
                  {formatCurrency(total)}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Payment Form */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="lg:col-span-3"
          >
            <div className="rounded-lg border border-border bg-card p-6 shadow-soft">
              <h2 className="font-serif text-xl text-ink mb-5">Payment Details</h2>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handlePay();
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">Card number</label>
                  <input type="text" defaultValue="4242 4242 4242 4242" className={inputClass} readOnly />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Expiry</label>
                    <input type="text" defaultValue="12/28" className={inputClass} readOnly />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">CVC</label>
                    <input type="text" defaultValue="123" className={inputClass} readOnly />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">Name on card</label>
                  <input type="text" placeholder="Full name" className={inputClass} defaultValue="Sarah Chen" />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={cn(
                    "w-full mt-2 rounded-md py-3.5 text-sm font-semibold text-white transition-all",
                    loading
                      ? "bg-accent/70 cursor-not-allowed"
                      : "bg-accent hover:bg-accent-deep active:scale-[0.98] shadow-soft hover:shadow-hover"
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
                  ) : (
                    `Pay ${formatCurrency(total)}`
                  )}
                </button>

                <p className="flex items-center justify-center gap-1.5 text-xs text-muted pt-1">
                  <Lock className="h-3 w-3" />
                  Secured by Stripe
                </p>
              </form>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper px-4 py-12 text-muted text-sm">Loading...</div>}>
      <CheckoutContent />
    </Suspense>
  );
}
